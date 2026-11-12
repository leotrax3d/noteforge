import { PalmRejection } from "../palm-rejection";
import { PALETTES, drawBackground, pageFill, type Palette } from "./background";
import {
  apply,
  eraseFromStroke,
  hitStroke,
  isIdentity,
  pointInPolygon,
  similarity,
  strokeInLasso,
  transformStroke,
  unionBBox,
  type Mat,
  type Vec,
} from "./geometry";
import { a4PageCount, a4Size, clampZoom, type PageSetup } from "./layout";
import { PSTRIDE, intersects, makeStroke, uid, type PenKind, type Stroke } from "./model";
import { PENS, buildPath, drawStroke, strokePath, toFreehand } from "./pens";
import { StrokeStore, type Change } from "./store";
import { TileCache } from "./tiles";
import type { BBox } from "@/lib/types";

export type Tool = "pen" | "eraser" | "lasso" | "pan";
export type EraserMode = "stroke" | "partial";

export interface ToolState {
  tool: Tool;
  pen: PenKind;
  color: string;
  width: number;
  eraserMode: EraserMode;
  /** Radius in Bildschirmpixeln. */
  eraserSize: number;
  /** Ein Finger zeichnet (sonst: verschiebt). */
  fingerDraws: boolean;
}

export interface SelectionInfo {
  count: number;
  /** Bildschirm-Rechteck (CSS-Pixel relativ zum Host). */
  rect: BBox;
  color: string | null;
}

export interface EngineEvents {
  onHistory?: (canUndo: boolean, canRedo: boolean) => void;
  onDirty?: () => void;
  /** Wird direkt aus dem Hot Path aufgerufen – nur DOM schreiben, kein React-State. */
  onCamera?: (scale: number) => void;
  onSelection?: (s: SelectionInfo | null) => void;
}

type Mode = "idle" | "draw" | "erase" | "lasso" | "transform" | "pan" | "gesture";
type Handle = "move" | "scale" | "rotate";

const HANDLE_R = 22; // Trefferradius ≥ 44 px Durchmesser
const ROT_OFFSET = 36;
const TAP_MS = 350;
const TAP_SLOP = 12;

/** Wachsender Punktpuffer (x, y, p, tilt, t) ohne Allokation pro Event. */
class Points {
  data = new Float32Array(1024 * PSTRIDE);
  n = 0;
  push(x: number, y: number, p: number, tilt: number, t: number) {
    let i = this.n * PSTRIDE;
    if (i + PSTRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data;
    d[i++] = x;
    d[i++] = y;
    d[i++] = p;
    d[i++] = tilt;
    d[i] = t;
    this.n++;
  }
  snapshot() {
    return this.data.slice(0, this.n * PSTRIDE);
  }
}

interface Selection {
  strokes: Stroke[];
  bbox: BBox;
  center: Vec;
  tx: number;
  ty: number;
  theta: number;
  s: number;
}

export class CanvasEngine {
  readonly store = new StrokeStore();
  events: EngineEvents = {};

  private baseCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private W = 0;
  private H = 0;
  private cam = { x: 0, y: 0, s: 1 };
  private tiles = new TileCache();
  private setup: PageSetup = { mode: "infinite", orientation: "portrait", background: "grid", bgSpacingMm: 5, pageColor: "#ffffff" };
  private pal: Palette = PALETTES.light;
  private pageCount = 1;
  private contentBottom = 0;
  private fitted = false;

  private tool: ToolState = {
    tool: "pen", pen: "fountain", color: "#1e3a8a", width: 2.5,
    eraserMode: "stroke", eraserSize: 14, fingerDraws: true,
  };

  // Eingabe
  private palm = new PalmRejection();
  private mode: Mode = "idle";
  private activeId = -1;
  private activeType = "";
  private rect: DOMRect | null = null;
  private touches = new Map<number, Vec>();
  private hover: Vec | null = null;
  private hoverEraser = false;

  // Strich
  private pts = new Points();
  private pred = new Points();
  private t0 = 0;
  private livePen: PenKind = "fountain";
  private liveColor = "#000";
  private liveWidth = 2;
  private livePressure = false;

  // Radierer
  private erased = { add: new Map<string, Stroke>(), remove: new Map<string, Stroke>() };
  private eraseLast: Vec | null = null;
  private eraseMode: EraserMode = "stroke";
  private hits: Stroke[] = [];

  // Lasso + Auswahl
  private lasso: number[] = [];
  private sel: Selection | null = null;
  private hidden = new Set<string>();
  private handle: Handle | null = null;
  private grab = { w: { x: 0, y: 0 }, tx: 0, ty: 0, theta: 0, s: 1 };

  // Pan / Geste
  private panLast: Vec = { x: 0, y: 0 };
  private g = { ids: "", dist: 1, mid: { x: 0, y: 0 }, cam: { x: 0, y: 0, s: 1 }, start: 0, fingers: 0, moved: false };

  // Rendering
  private raf = 0;
  private baseDirty = true;
  private activeDirty = true;
  private rescaleTimer = 0;
  private rescaleNow = false;
  private ro: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private base: HTMLCanvasElement,
    private active: HTMLCanvasElement,
  ) {
    this.baseCtx = base.getContext("2d", { alpha: false })!;
    this.activeCtx = active.getContext("2d", { alpha: true, desynchronized: true })!;
    active.style.touchAction = "none";
    const a = active;
    a.addEventListener("pointerdown", this.onDown);
    a.addEventListener("pointermove", this.onMove);
    a.addEventListener("pointerup", this.onUp);
    a.addEventListener("pointercancel", this.onCancel);
    a.addEventListener("pointerleave", this.onLeave);
    a.addEventListener("wheel", this.onWheel, { passive: false });
    a.addEventListener("contextmenu", prevent);
    a.addEventListener("touchstart", prevent, { passive: false });
    this.store.onApply = this.onApply;
    this.store.onHistory = () => this.events.onHistory?.(this.store.canUndo, this.store.canRedo);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.rescaleTimer);
    this.ro.disconnect();
    const a = this.active;
    a.removeEventListener("pointerdown", this.onDown);
    a.removeEventListener("pointermove", this.onMove);
    a.removeEventListener("pointerup", this.onUp);
    a.removeEventListener("pointercancel", this.onCancel);
    a.removeEventListener("pointerleave", this.onLeave);
    a.removeEventListener("wheel", this.onWheel);
    a.removeEventListener("contextmenu", prevent);
    a.removeEventListener("touchstart", prevent);
  }

  // ================= Öffentliche API =================

  load(strokes: Stroke[]) {
    this.store.load(strokes);
    this.recomputeBottom();
    this.tiles.clear();
    this.invalidate(true);
  }

  setPage(setup: PageSetup) {
    const modeChanged = setup.mode !== this.setup.mode || setup.orientation !== this.setup.orientation;
    this.setup = { ...setup };
    this.pageCount = this.calcPageCount();
    if (modeChanged) this.fitted = false;
    this.fit();
    this.tiles.clear();
    this.invalidate(true);
  }

  setDark(dark: boolean) {
    this.pal = dark ? PALETTES.dark : PALETTES.light;
    this.tiles.clear();
    this.updateBlend();
    this.invalidate(true);
  }

  setTool(t: ToolState) {
    if (t.tool !== "lasso" && this.sel && t.tool !== this.tool.tool) this.commitSelection();
    this.tool = { ...t };
    this.updateBlend();
    this.invalidate(false);
  }

  get zoom() {
    return this.cam.s;
  }

  undo() {
    if (this.mode !== "idle") return;
    this.commitSelection();
    this.store.undo();
  }

  redo() {
    if (this.mode !== "idle") return;
    this.commitSelection();
    this.store.redo();
  }

  zoomTo(scale: number, at: Vec = { x: this.W / 2, y: this.H / 2 }) {
    const s = clampZoom(scale);
    const wx = at.x / this.cam.s + this.cam.x, wy = at.y / this.cam.s + this.cam.y;
    this.cam = { s, x: wx - at.x / s, y: wy - at.y / s };
    this.cameraChanged(true);
  }

  zoomBy(f: number) {
    this.zoomTo(this.cam.s * f);
  }

  resetView() {
    this.fitted = false;
    this.fit();
    this.cameraChanged(true);
  }

  // ---- Auswahl-Aktionen ----

  get hasSelection() {
    return !!this.sel;
  }

  recolorSelection(color: string) {
    const sel = this.sel;
    if (!sel) return;
    const m = this.selMatrix();
    const next = sel.strokes.map((s) => ({ ...transformStroke(s, m), color }));
    this.store.commit({ remove: sel.strokes, add: next });
    this.select(next);
  }

  duplicateSelection() {
    const sel = this.sel;
    if (!sel) return;
    const m = this.selMatrix();
    const baked = sel.strokes.map((s) => transformStroke(s, m));
    if (!isIdentity(m)) this.store.commit({ remove: sel.strokes, add: baked });
    this.unhide();
    const off: Mat = [1, 0, 0, 1, 24 / this.cam.s, 24 / this.cam.s];
    const copies = baked.map((s) => ({ ...transformStroke(s, off, false), z: this.store.nextZ() }));
    this.store.commit({ remove: [], add: copies });
    this.select(copies);
  }

  deleteSelection() {
    const sel = this.sel;
    if (!sel) return;
    this.sel = null;
    this.unhide();
    this.store.commit({ remove: sel.strokes, add: [] });
    this.emitSelection();
  }

  /** Auswahl übernehmen (Transformation einbacken) und aufheben. */
  commitSelection() {
    const sel = this.sel;
    if (!sel) return;
    const m = this.selMatrix();
    this.sel = null;
    if (!isIdentity(m)) {
      const next = sel.strokes.map((s) => transformStroke(s, m));
      this.unhide();
      this.store.commit({ remove: sel.strokes, add: next });
    } else {
      this.unhide();
      this.tiles.invalidate(sel.bbox);
      this.invalidate(true);
    }
    this.emitSelection();
  }

  // ================= Layout / Kamera =================

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.W = r.width;
    this.H = r.height;
    for (const c of [this.base, this.active]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.tiles.clear(this.cam.s * dpr);
    }
    this.fit();
    this.invalidate(true);
  }

  private fit() {
    if (this.fitted || this.W === 0) return;
    this.fitted = true;
    if (this.setup.mode === "a4") {
      const { w } = a4Size(this.setup.orientation);
      const s = clampZoom(Math.min(1, (this.W - 48) / w));
      this.cam = { s, x: -(this.W / s - w) / 2, y: -24 / s };
    } else {
      this.cam = { s: 1, x: 0, y: 0 };
    }
    this.tiles.clear(this.cam.s * this.dpr);
    this.events.onCamera?.(this.cam.s);
  }

  private cameraChanged(rescaleSoon: boolean) {
    this.events.onCamera?.(this.cam.s);
    const target = this.cam.s * this.dpr;
    const ratio = target / this.tiles.scale;
    if (ratio > 2 || ratio < 0.5) this.rescaleNow = true; // zu weit weg → sofort neu
    if (rescaleSoon && ratio !== 1) {
      clearTimeout(this.rescaleTimer);
      this.rescaleTimer = window.setTimeout(() => {
        this.rescaleNow = true;
        this.invalidate(true);
        this.emitSelection();
      }, 180);
    }
    this.invalidate(true);
  }

  private toWorld(sx: number, sy: number): Vec {
    return { x: sx / this.cam.s + this.cam.x, y: sy / this.cam.s + this.cam.y };
  }

  private toScreen(wx: number, wy: number): Vec {
    return { x: (wx - this.cam.x) * this.cam.s, y: (wy - this.cam.y) * this.cam.s };
  }

  private local(e: PointerEvent): Vec {
    if (!this.rect) this.rect = this.active.getBoundingClientRect();
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
  }

  // ================= Store-Rückmeldungen =================

  private onApply = (c: Change) => {
    // Reines Hinzufügen ohne Textmarker → direkt auf vorhandene Tiles zeichnen.
    const additive = c.remove.length === 0 && c.add.every((s) => s.pen !== "highlighter" && !this.hidden.has(s.id));
    if (additive) {
      for (const s of c.add) this.paintOnTiles(s);
    } else {
      for (const s of c.remove) this.tiles.invalidate(s.bbox);
      for (const s of c.add) this.tiles.invalidate(s.bbox);
    }
    if (c.remove.length) this.recomputeBottom();
    else for (const s of c.add) this.contentBottom = Math.max(this.contentBottom, s.bbox.y + s.bbox.h);
    const pc = this.calcPageCount();
    if (pc !== this.pageCount) {
      this.pageCount = pc;
      this.tiles.clear();
    }
    this.invalidate(true);
    this.events.onDirty?.();
  };

  private paintOnTiles(s: Stroke) {
    const ws = this.tiles.worldSize;
    const b = s.bbox;
    for (let ty = Math.floor(b.y / ws); ty <= Math.floor((b.y + b.h) / ws); ty++)
      for (let tx = Math.floor(b.x / ws); tx <= Math.floor((b.x + b.w) / ws); tx++) {
        const ctx = this.tiles.existing(tx, ty);
        if (ctx) drawStroke(ctx, s, this.pal.dark);
      }
  }

  private recomputeBottom() {
    let b = 0;
    for (const s of this.store.all()) b = Math.max(b, s.bbox.y + s.bbox.h);
    this.contentBottom = b;
  }

  private calcPageCount() {
    return this.setup.mode === "a4" ? a4PageCount(this.contentBottom, this.setup.orientation) : 1;
  }

  private updateBlend() {
    const hl = this.tool.tool === "pen" && this.tool.pen === "highlighter";
    this.active.style.mixBlendMode = hl ? (this.pal.dark ? "screen" : "multiply") : "normal";
  }

  // ================= Eingabe =================

  private onDown = (e: PointerEvent) => {
    const now = performance.now();
    const p = this.local(e);
    if (e.pointerType === "touch") this.touches.set(e.pointerId, p);
    const decision = this.palm.onDown(e.pointerType, e.pointerId, now);

    if (e.pointerType === "touch" && this.touches.size >= 2) {
      if (this.mode !== "idle" && this.mode !== "gesture" && this.activeType !== "touch") return; // Stift/Maus aktiv → Handballen
      if (this.mode !== "gesture") this.startGesture(now);
      else this.g.fingers = Math.max(this.g.fingers, this.touches.size);
      return;
    }
    if (decision === "ignore") return;
    if (this.mode !== "idle") return;
    if (e.pointerType === "mouse" && e.button === 2) return;

    this.rect = this.active.getBoundingClientRect();
    const q = this.local(e);
    e.preventDefault();
    this.active.setPointerCapture(e.pointerId);
    this.activeId = e.pointerId;
    this.activeType = e.pointerType;

    // Stift-Radierende (Taste 5) / Seitentaste → Lasso
    const penEraser = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
    const penBarrel = e.pointerType === "pen" && !penEraser && (e.button === 2 || (e.buttons & 2) !== 0);
    let tool: Tool = penEraser ? "eraser" : penBarrel ? "lasso" : this.tool.tool;
    if (e.pointerType === "mouse" && e.button === 1) tool = "pan";
    if (e.pointerType === "touch" && !this.tool.fingerDraws && tool !== "pan") tool = "pan";

    // Auswahl-Griffe haben Vorrang
    if (this.sel && tool !== "pan") {
      const h = this.hitHandle(q);
      if (h) return this.beginTransform(h, q);
      this.commitSelection();
    }

    switch (tool) {
      case "pen":
        return this.beginStroke(e, q);
      case "eraser":
        return this.beginErase(q);
      case "lasso":
        return this.beginLasso(q);
      case "pan":
        this.mode = "pan";
        this.panLast = q;
        return;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, this.local(e));
      if (this.mode === "gesture") return this.updateGesture();
    }
    if (e.pointerType === "pen") this.palm.notePen(performance.now());
    if (e.pointerId !== this.activeId) {
      if (this.mode === "idle" && e.pointerType !== "touch") {
        const eraser = this.tool.tool === "eraser" || (e.pointerType === "pen" && (e.buttons & 32) !== 0);
        if (eraser || this.hoverEraser) {
          this.rect = null;
          this.hover = this.local(e);
          this.hoverEraser = eraser;
          this.invalidate(false);
        }
      }
      return;
    }
    switch (this.mode) {
      case "draw": {
        const list = e.getCoalescedEvents?.();
        if (list && list.length) for (let i = 0; i < list.length; i++) this.addPoint(list[i]);
        else this.addPoint(e);
        this.pred.n = 0;
        const pr = e.getPredictedEvents?.();
        if (pr) for (let i = 0; i < pr.length; i++) this.addPoint(pr[i], this.pred);
        this.activeDirty = true;
        this.request();
        return;
      }
      case "erase": {
        const list = e.getCoalescedEvents?.();
        if (list && list.length) for (let i = 0; i < list.length; i++) this.eraseTo(this.local(list[i]));
        else this.eraseTo(this.local(e));
        return;
      }
      case "lasso": {
        const w = this.toWorld(...xy(this.local(e)));
        this.lasso.push(w.x, w.y);
        this.invalidate(false);
        return;
      }
      case "transform":
        return this.updateTransform(this.local(e));
      case "pan": {
        const q = this.local(e);
        this.cam.x -= (q.x - this.panLast.x) / this.cam.s;
        this.cam.y -= (q.y - this.panLast.y) / this.cam.s;
        this.panLast = q;
        this.cameraChanged(false);
        return;
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    this.palm.onUp(e.pointerType, e.pointerId, performance.now());
    if (e.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      if (this.mode === "gesture") {
        if (this.touches.size === 0) this.endGesture();
        else this.g.ids = ""; // neu ausrichten
        return;
      }
    }
    if (e.pointerId !== this.activeId) return;
    switch (this.mode) {
      case "draw":
        this.addPoint(e);
        this.commitStroke();
        break;
      case "erase":
        this.endErase();
        break;
      case "lasso":
        this.endLasso();
        break;
      case "transform":
        this.handle = null;
        this.mode = "idle";
        this.emitSelection();
        break;
      case "pan":
        this.emitSelection();
        break;
    }
    this.endPointer();
  };

  private onCancel = (e: PointerEvent) => {
    this.palm.onUp(e.pointerType, e.pointerId, performance.now());
    this.touches.delete(e.pointerId);
    if (this.mode === "gesture" && this.touches.size === 0) {
      this.mode = "idle";
      return;
    }
    if (e.pointerId !== this.activeId) return;
    if (this.mode === "erase") this.endErase();
    if (this.mode === "lasso") this.lasso = [];
    this.endPointer();
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.palm.notePen(performance.now());
    if (this.hover) {
      this.hover = null;
      this.invalidate(false);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.H : 1;
    this.rect = this.active.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const at = { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
      this.zoomTo(this.cam.s * Math.exp(-e.deltaY * k * 0.0025), at);
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      this.cam.x += (dx * k) / this.cam.s;
      this.cam.y += (dy * k) / this.cam.s;
      this.cameraChanged(true);
    }
  };

  private endPointer() {
    if (this.activeId !== -1 && this.active.hasPointerCapture(this.activeId)) this.active.releasePointerCapture(this.activeId);
    this.activeId = -1;
    this.activeType = "";
    this.mode = "idle";
    this.invalidate(false);
  }

  // ---- Gesten (2 Finger Zoom/Pan, 2-Finger-Tipp Undo, 3-Finger-Tipp Redo) ----

  private startGesture(now: number) {
    // Laufende Ein-Finger-Aktion verwerfen
    if (this.mode === "draw") this.pts.n = 0;
    if (this.mode === "lasso") this.lasso = [];
    if (this.mode === "erase") this.endErase();
    if (this.activeId !== -1) this.endPointer();
    this.mode = "gesture";
    this.g.start = now;
    this.g.fingers = this.touches.size;
    this.g.moved = false;
    this.g.ids = "";
    this.updateGesture();
  }

  private updateGesture() {
    const it = this.touches.entries();
    const a = it.next().value, b = it.next().value;
    if (!a || !b) return;
    this.g.fingers = Math.max(this.g.fingers, this.touches.size);
    const ids = a[0] + ":" + b[0];
    const mid = { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 };
    const dist = Math.max(1, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y));
    if (ids !== this.g.ids) {
      this.g.ids = ids;
      this.g.dist = dist;
      this.g.mid = mid;
      this.g.cam = { ...this.cam };
      return;
    }
    const s = clampZoom((this.g.cam.s * dist) / this.g.dist);
    const wx = this.g.mid.x / this.g.cam.s + this.g.cam.x;
    const wy = this.g.mid.y / this.g.cam.s + this.g.cam.y;
    this.cam = { s, x: wx - mid.x / s, y: wy - mid.y / s };
    if (Math.hypot(mid.x - this.g.mid.x, mid.y - this.g.mid.y) > TAP_SLOP || Math.abs(dist - this.g.dist) > TAP_SLOP)
      this.g.moved = true;
    this.cameraChanged(true);
  }

  private endGesture() {
    this.mode = "idle";
    const tap = !this.g.moved && performance.now() - this.g.start < TAP_MS;
    if (tap && this.g.fingers === 2) this.undo();
    else if (tap && this.g.fingers >= 3) this.redo();
    this.emitSelection();
  }

  // ---- Stift ----

  private beginStroke(e: PointerEvent, q: Vec) {
    void q;
    this.mode = "draw";
    const t = this.tool;
    this.livePen = t.pen;
    this.liveColor = t.color;
    this.liveWidth = t.width;
    this.livePressure = e.pointerType === "pen" && t.pen !== "ballpoint" && t.pen !== "highlighter";
    this.t0 = e.timeStamp;
    this.pts.n = 0;
    this.pred.n = 0;
    this.addPoint(e);
    this.activeDirty = true;
    this.request();
  }

  private addPoint(e: PointerEvent, buf = this.pts) {
    const q = this.local(e);
    const x = q.x / this.cam.s + this.cam.x, y = q.y / this.cam.s + this.cam.y;
    const p = e.pointerType === "pen" ? (e.pressure > 0 ? e.pressure : 0.3) : 0.5;
    const tilt = Math.max(Math.abs(e.tiltX || 0), Math.abs(e.tiltY || 0));
    if (buf === this.pts && buf.n > 0) {
      const i = (buf.n - 1) * PSTRIDE;
      if (buf.data[i] === x && buf.data[i + 1] === y) {
        buf.data[i + 2] = p;
        return;
      }
    }
    buf.push(x, y, p, tilt, e.timeStamp - this.t0);
  }

  private commitStroke() {
    if (this.pts.n > 0) {
      const s = makeStroke({
        id: uid(),
        z: this.store.nextZ(),
        pen: this.livePen,
        color: this.liveColor,
        width: this.liveWidth,
        opacity: PENS[this.livePen].opacity,
        pressure: this.livePressure,
        points: this.pts.snapshot(),
      });
      this.store.commit({ add: [s], remove: [] });
    }
    this.pts.n = 0;
    this.pred.n = 0;
  }

  // ---- Radierer ----

  private beginErase(q: Vec) {
    this.mode = "erase";
    this.eraseMode = this.tool.eraserMode;
    this.erased.add.clear();
    this.erased.remove.clear();
    this.eraseLast = null;
    this.hover = q;
    this.eraseTo(q);
  }

  private eraseTo(q: Vec) {
    this.hover = q;
    const w = this.toWorld(q.x, q.y);
    const r = this.tool.eraserSize / this.cam.s;
    const last = this.eraseLast ?? w;
    const d = Math.hypot(w.x - last.x, w.y - last.y);
    const steps = Math.max(1, Math.ceil(d / (r * 0.5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.eraseAt(last.x + (w.x - last.x) * t, last.y + (w.y - last.y) * t, r);
    }
    this.eraseLast = w;
    this.invalidate(false);
  }

  private eraseAt(x: number, y: number, r: number) {
    const hits = this.hits;
    hits.length = 0;
    for (const s of this.store.all()) if (!this.hidden.has(s.id) && hitStroke(s, x, y, r)) hits.push(s);
    for (const s of hits) {
      const pieces = this.eraseMode === "partial" ? eraseFromStroke(s, x, y, r) ?? [] : [];
      this.store.applyRaw({ remove: [s], add: pieces });
      if (this.erased.add.has(s.id)) this.erased.add.delete(s.id);
      else this.erased.remove.set(s.id, s);
      for (const p of pieces) this.erased.add.set(p.id, p);
    }
  }

  private endErase() {
    this.store.record({ add: [...this.erased.add.values()], remove: [...this.erased.remove.values()] });
    this.erased.add.clear();
    this.erased.remove.clear();
  }

  // ---- Lasso / Auswahl ----

  private beginLasso(q: Vec) {
    this.mode = "lasso";
    const w = this.toWorld(q.x, q.y);
    this.lasso = [w.x, w.y];
  }

  private endLasso() {
    const poly = this.lasso;
    this.lasso = [];
    const picked = this.store.all().filter((s) => strokeInLasso(s, poly));
    if (picked.length) this.select(picked);
  }

  private select(strokes: Stroke[]) {
    this.unhide();
    const bbox = unionBBox(strokes);
    this.sel = { strokes, bbox, center: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, tx: 0, ty: 0, theta: 0, s: 1 };
    for (const s of strokes) this.hidden.add(s.id);
    this.tiles.invalidate(bbox);
    this.invalidate(true);
    this.emitSelection();
  }

  private unhide() {
    if (!this.hidden.size) return;
    for (const id of this.hidden) {
      const s = this.store.get(id);
      if (s) this.tiles.invalidate(s.bbox);
    }
    this.hidden.clear();
    this.invalidate(true);
  }

  private selMatrix(): Mat {
    const s = this.sel!;
    return similarity(s.center, s.tx, s.ty, s.theta, s.s);
  }

  /** Ecken der Auswahl (Bildschirm): oben links, oben rechts, unten rechts, unten links. */
  private selCorners(): Vec[] {
    const m = this.selMatrix();
    const b = this.sel!.bbox;
    const pad = 6 / this.cam.s;
    const xs = [b.x - pad, b.x + b.w + pad], ys = [b.y - pad, b.y + b.h + pad];
    return [
      [xs[0], ys[0]], [xs[1], ys[0]], [xs[1], ys[1]], [xs[0], ys[1]],
    ].map(([x, y]) => {
      const w = apply(m, x, y);
      return this.toScreen(w.x, w.y);
    });
  }

  private rotHandle(c: Vec[]): Vec {
    const top = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
    const bot = { x: (c[3].x + c[2].x) / 2, y: (c[3].y + c[2].y) / 2 };
    const len = Math.hypot(top.x - bot.x, top.y - bot.y) || 1;
    return { x: top.x + ((top.x - bot.x) / len) * ROT_OFFSET, y: top.y + ((top.y - bot.y) / len) * ROT_OFFSET };
  }

  private hitHandle(q: Vec): Handle | null {
    if (!this.sel) return null;
    const c = this.selCorners();
    const near = (p: Vec) => Math.hypot(p.x - q.x, p.y - q.y) <= HANDLE_R;
    if (near(this.rotHandle(c))) return "rotate";
    if (c.some(near)) return "scale";
    const poly = c.flatMap((p) => [p.x, p.y]);
    return pointInPolygon(q.x, q.y, poly) ? "move" : null;
  }

  private beginTransform(h: Handle, q: Vec) {
    const s = this.sel!;
    this.mode = "transform";
    this.handle = h;
    this.grab = { w: this.toWorld(q.x, q.y), tx: s.tx, ty: s.ty, theta: s.theta, s: s.s };
    this.events.onSelection?.(null); // Menü während des Ziehens ausblenden
  }

  private updateTransform(q: Vec) {
    const s = this.sel;
    if (!s) return;
    const w = this.toWorld(q.x, q.y);
    const g = this.grab;
    const c = { x: s.center.x + g.tx, y: s.center.y + g.ty };
    if (this.handle === "move") {
      s.tx = g.tx + w.x - g.w.x;
      s.ty = g.ty + w.y - g.w.y;
    } else if (this.handle === "scale") {
      const d0 = Math.hypot(g.w.x - c.x, g.w.y - c.y) || 1;
      s.s = Math.min(20, Math.max(0.05, (g.s * Math.hypot(w.x - c.x, w.y - c.y)) / d0));
    } else if (this.handle === "rotate") {
      let th = g.theta + Math.atan2(w.y - c.y, w.x - c.x) - Math.atan2(g.w.y - c.y, g.w.x - c.x);
      const snap = Math.PI / 12;
      const near = Math.round(th / snap) * snap;
      if (Math.abs(th - near) < (4 * Math.PI) / 180) th = near;
      s.theta = th;
    }
    this.invalidate(false);
  }

  private emitSelection() {
    const cb = this.events.onSelection;
    if (!cb) return;
    if (!this.sel || this.mode === "transform") return cb(null);
    const c = this.selCorners();
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    const colors = new Set(this.sel.strokes.map((s) => s.color));
    cb({
      count: this.sel.strokes.length,
      rect: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
      color: colors.size === 1 ? [...colors][0] : null,
    });
  }

  // ================= Rendering =================

  private invalidate(base: boolean) {
    if (base) this.baseDirty = true;
    this.activeDirty = true;
    this.request();
  }

  private request() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    this.raf = 0;
    if (this.baseDirty) {
      this.baseDirty = false;
      this.renderBase();
    }
    if (this.activeDirty) {
      this.activeDirty = false;
      this.renderActive();
    }
  };

  private renderBase() {
    const target = this.cam.s * this.dpr;
    if (this.rescaleNow) {
      this.rescaleNow = false;
      if (this.tiles.scale !== target) this.tiles.clear(target);
    }
    const unlimited = this.tiles.size === 0;
    let budget = unlimited ? Infinity : 6;
    const ctx = this.baseCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ws = this.tiles.worldSize;
    const k = this.cam.s * this.dpr; // Gerätepixel pro Welteinheit
    const x0 = Math.floor(this.cam.x / ws), y0 = Math.floor(this.cam.y / ws);
    const x1 = Math.floor((this.cam.x + this.W / this.cam.s) / ws);
    const y1 = Math.floor((this.cam.y + this.H / this.cam.s) / ws);
    let missing = false;
    ctx.imageSmoothingEnabled = true;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        let c = this.tiles.peek(tx, ty);
        if (!c && budget > 0) {
          budget--;
          c = this.renderTile(tx, ty);
        }
        const sx = Math.round((tx * ws - this.cam.x) * k), sy = Math.round((ty * ws - this.cam.y) * k);
        const ex = Math.round(((tx + 1) * ws - this.cam.x) * k), ey = Math.round(((ty + 1) * ws - this.cam.y) * k);
        if (c) ctx.drawImage(c, sx, sy, ex - sx, ey - sy);
        else {
          missing = true;
          ctx.fillStyle = this.setup.mode === "a4" ? this.pal.desk : pageFill(this.setup, this.pal);
          ctx.fillRect(sx, sy, ex - sx, ey - sy);
        }
      }
    if (missing) {
      this.baseDirty = true;
      this.request();
    }
  }

  private renderTile(tx: number, ty: number): HTMLCanvasElement | undefined {
    const ctx = this.tiles.create(tx, ty);
    if (!ctx) return undefined;
    const r = this.tiles.tileRect(tx, ty);
    drawBackground(ctx, r, this.tiles.scale, this.setup, this.pal, this.pageCount);
    for (const s of this.store.all()) {
      if (!this.hidden.has(s.id) && intersects(s.bbox, r)) drawStroke(ctx, s, this.pal.dark);
    }
    return this.tiles.peek(tx, ty);
  }

  private worldTransform(ctx: CanvasRenderingContext2D) {
    const k = this.cam.s * this.dpr;
    ctx.setTransform(k, 0, 0, k, -this.cam.x * k, -this.cam.y * k);
  }

  private renderActive() {
    const ctx = this.activeCtx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.active.width, this.active.height);
    const dark = this.pal.dark;

    if (this.mode === "draw" && this.pts.n > 0) {
      this.worldTransform(ctx);
      const constant = this.livePen === "ballpoint";
      const pts = toFreehand(this.pts.data, this.pts.n, constant);
      if (this.pred.n) for (const p of toFreehand(this.pred.data, this.pred.n, constant)) pts.push(p);
      const path = buildPath(this.livePen, this.liveWidth, this.livePressure, pts, false);
      drawStroke(ctx, { pen: this.livePen, color: this.liveColor, opacity: PENS[this.livePen].opacity } as Stroke, dark, path);
    }

    if (this.sel) {
      this.worldTransform(ctx);
      const m = this.selMatrix();
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      for (const s of this.sel.strokes) drawStroke(ctx, s, dark, strokePath(s));
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = this.selCorners();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      const rh = this.rotHandle(c);
      ctx.beginPath();
      ctx.moveTo((c[0].x + c[1].x) / 2, (c[0].y + c[1].y) / 2);
      ctx.lineTo(rh.x, rh.y);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      for (const p of [...c, rh]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p === rh ? 9 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (this.mode === "lasso" && this.lasso.length >= 4) {
      this.worldTransform(ctx);
      ctx.beginPath();
      for (let i = 0; i < this.lasso.length; i += 2)
        i ? ctx.lineTo(this.lasso[i], this.lasso[i + 1]) : ctx.moveTo(this.lasso[i], this.lasso[i + 1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(59,130,246,0.08)";
      ctx.fill();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      for (let i = 0; i < this.lasso.length; i += 2) {
        const p = this.toScreen(this.lasso[i], this.lasso[i + 1]);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const showEraser = this.mode === "erase" || (this.mode === "idle" && this.hover && (this.tool.tool === "eraser" || this.hoverEraser));
    if (showEraser && this.hover) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(this.hover.x, this.hover.y, this.tool.eraserSize, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
      ctx.fill();
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

const xy = (v: Vec): [number, number] => [v.x, v.y];

function prevent(e: Event) {
  e.preventDefault();
}
