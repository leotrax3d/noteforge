import { PalmRejection } from "./palm-rejection";
import { PointBuffer, STRIDE } from "./point-buffer";
import { FrameStats } from "./stats";
import { outlineToPath, strokeOutline, type StrokeStyle } from "./stroke";

export interface EngineStats {
  fps: number;
  latencyAvg: number;
  latencyMax: number;
  pointerType: string;
  pressure: number;
  strokes: number;
  rejected: number;
  desynchronized: boolean;
}

interface StoredStroke {
  points: Float32Array;
  style: StrokeStyle;
  path: Path2D;
}

/**
 * Ink-Engine ohne React: zwei Canvas-Ebenen.
 *  - base:   fertige Striche (wird nur bei Änderung neu gezeichnet)
 *  - active: aktueller Strich + Vorhersage, `desynchronized` für geringe Latenz
 */
export class InkEngine {
  style: StrokeStyle = { color: "#1e40af", size: 6, pressure: true };
  usePrediction = true;
  onStats?: (s: EngineStats) => void;

  private baseCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;

  private palm = new PalmRejection();
  private stats = new FrameStats(500);
  private strokes: StoredStroke[] = [];
  private current = new PointBuffer();
  private predicted = new PointBuffer(32);
  private activeId = -1;
  private activeType = "";
  private activeStyle: StrokeStyle = this.style;
  private dirty = false;
  /** Zeitstempel des ältesten noch nicht gezeichneten Input-Events. */
  private pendingInputTs = -1;
  private rafId = 0;
  private lastPointerType = "–";
  private lastPressure = 0;
  private rejected = 0;
  private desync: boolean;
  private ro: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private base: HTMLCanvasElement,
    private active: HTMLCanvasElement,
  ) {
    this.baseCtx = base.getContext("2d", { alpha: true })!;
    const actx = active.getContext("2d", { alpha: true, desynchronized: true });
    this.activeCtx = actx!;
    this.desync = !!(this.activeCtx.getContextAttributes?.().desynchronized);

    active.style.touchAction = "none";
    active.addEventListener("pointerdown", this.onDown);
    active.addEventListener("pointermove", this.onMove);
    active.addEventListener("pointerup", this.onUp);
    active.addEventListener("pointercancel", this.onCancel);
    active.addEventListener("pointerleave", this.onLeave);
    active.addEventListener("contextmenu", prevent);
    active.addEventListener("touchstart", prevent, { passive: false });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.ro.disconnect();
    const a = this.active;
    a.removeEventListener("pointerdown", this.onDown);
    a.removeEventListener("pointermove", this.onMove);
    a.removeEventListener("pointerup", this.onUp);
    a.removeEventListener("pointercancel", this.onCancel);
    a.removeEventListener("pointerleave", this.onLeave);
    a.removeEventListener("contextmenu", prevent);
    a.removeEventListener("touchstart", prevent);
  }

  clear() {
    this.strokes = [];
    this.redrawBase();
  }

  undo() {
    this.strokes.pop();
    this.redrawBase();
  }

  get strokeCount() {
    return this.strokes.length;
  }

  // ---------- Layout ----------

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = r.width;
    this.height = r.height;
    for (const c of [this.base, this.active]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    this.redrawBase();
    this.dirty = true;
  }

  private redrawBase() {
    const ctx = this.baseCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    for (const s of this.strokes) {
      ctx.fillStyle = s.style.color;
      ctx.fill(s.path);
    }
  }

  // ---------- Input ----------

  private onDown = (e: PointerEvent) => {
    const now = performance.now();
    this.lastPointerType = e.pointerType;
    const decision = this.palm.onDown(e.pointerType, e.pointerId, now);
    if (decision === "gesture") {
      // Zweiter Finger: laufenden Touch-Strich verwerfen (Gesten folgen in Phase 2).
      if (this.activeId !== -1 && this.activeType === "touch") this.abortStroke();
      return;
    }
    if (decision === "ignore") {
      this.rejected++;
      return;
    }
    if (this.activeId !== -1) return; // nur ein Strich gleichzeitig
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.active.setPointerCapture(e.pointerId);
    this.activeId = e.pointerId;
    this.activeType = e.pointerType;
    this.activeStyle = { ...this.style, pressure: this.style.pressure && e.pointerType === "pen" };
    this.current.clear();
    this.predicted.clear();
    this.addPoint(e);
    this.markInput(e.timeStamp);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.palm.notePen(performance.now());
    if (e.pointerId !== this.activeId) return;
    const coalesced = e.getCoalescedEvents?.();
    if (coalesced && coalesced.length > 0) {
      for (let i = 0; i < coalesced.length; i++) this.addPoint(coalesced[i]);
      this.markInput(coalesced[0].timeStamp);
    } else {
      this.addPoint(e);
      this.markInput(e.timeStamp);
    }
    this.predicted.clear();
    if (this.usePrediction) {
      const pred = e.getPredictedEvents?.();
      if (pred) {
        for (let i = 0; i < pred.length; i++) {
          const p = pred[i];
          const xy = this.toLocal(p);
          this.predicted.push(xy.x, xy.y, this.pressureOf(p));
        }
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    this.palm.onUp(e.pointerType, e.pointerId, performance.now());
    if (e.pointerId !== this.activeId) return;
    this.addPoint(e);
    this.commitStroke();
  };

  private onCancel = (e: PointerEvent) => {
    this.palm.onUp(e.pointerType, e.pointerId, performance.now());
    if (e.pointerId === this.activeId) this.abortStroke();
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.palm.notePen(performance.now());
  };

  private local = { x: 0, y: 0 };
  private rect: DOMRect | null = null;

  private toLocal(e: PointerEvent) {
    if (!this.rect || this.current.length <= 1) this.rect = this.active.getBoundingClientRect();
    this.local.x = e.clientX - this.rect.left;
    this.local.y = e.clientY - this.rect.top;
    return this.local;
  }

  private pressureOf(e: PointerEvent) {
    if (e.pointerType !== "pen") return 0.5;
    return e.pressure > 0 ? e.pressure : 0.05;
  }

  private addPoint(e: PointerEvent) {
    const { x, y } = this.toLocal(e);
    const p = this.pressureOf(e);
    // Duplikate verwerfen (gleiche Position)
    const n = this.current.length;
    if (n > 0) {
      const i = (n - 1) * STRIDE;
      const d = this.current.data;
      if (d[i] === x && d[i + 1] === y) {
        d[i + 2] = p;
        return;
      }
    }
    this.current.push(x, y, p);
    this.lastPressure = p;
  }

  private markInput(ts: number) {
    if (this.pendingInputTs < 0) this.pendingInputTs = ts;
    this.dirty = true;
  }

  private commitStroke() {
    if (this.current.length > 0) {
      const outline = strokeOutline(this.current.toPoints(), this.activeStyle, true);
      const stroke: StoredStroke = {
        points: this.current.snapshot(),
        style: this.activeStyle,
        path: outlineToPath(outline),
      };
      this.strokes.push(stroke);
      const ctx = this.baseCtx;
      ctx.fillStyle = stroke.style.color;
      ctx.fill(stroke.path);
    }
    this.endStroke();
  }

  private abortStroke() {
    this.endStroke();
  }

  private endStroke() {
    if (this.activeId !== -1 && this.active.hasPointerCapture(this.activeId)) {
      this.active.releasePointerCapture(this.activeId);
    }
    this.activeId = -1;
    this.current.clear();
    this.predicted.clear();
    this.dirty = true;
  }

  // ---------- Render ----------

  private loop = (now: number) => {
    this.rafId = requestAnimationFrame(this.loop);
    if (this.dirty) {
      this.dirty = false;
      this.renderActive();
      if (this.pendingInputTs >= 0) {
        // Latenz: Event-Zeitstempel → Zeitpunkt, an dem der Frame gezeichnet ist.
        this.stats.latency(performance.now() - this.pendingInputTs);
        this.pendingInputTs = -1;
      }
    }
    if (this.stats.frame(now)) this.emitStats();
  };

  private renderActive() {
    const ctx = this.activeCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.current.length === 0) return;
    const pts = this.current.toPoints(this.predicted.length ? this.predicted : undefined);
    const outline = strokeOutline(pts, this.activeStyle, false);
    ctx.fillStyle = this.activeStyle.color;
    ctx.fill(outlineToPath(outline));
  }

  private emitStats() {
    this.onStats?.({
      fps: this.stats.fps,
      latencyAvg: this.stats.latencyAvg,
      latencyMax: this.stats.latencyMax,
      pointerType: this.lastPointerType,
      pressure: this.lastPressure,
      strokes: this.strokes.length,
      rejected: this.rejected,
      desynchronized: this.desync,
    });
  }
}

function prevent(e: Event) {
  e.preventDefault();
}
