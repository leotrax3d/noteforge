import { PALM_CONTACT_PX, PALM_SIZE_WINDOW_MS, PalmRejection } from "../palm-rejection";
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
import { a4PageCount, a4PageRect, a4Size, clampZoom, type PageSetup } from "./layout";
import { PSTRIDE, computeBBox, intersects, makeStroke, uid, type PenKind, type Stroke } from "./model";
import { PENS, buildOutline, buildPath, drawStroke, strokePath, toFreehand } from "./pens";
import { StrokeStore, type Change } from "./store";
import { TileCache } from "./tiles";
import { PerfMeter, type PerfSample } from "./perf";

/** Höchstens so lange pro Frame neue Kacheln rendern (ms). */
const TILE_BUDGET_MS = 8;
/** Nach Zoom (alle Kacheln neu): großzügiger, damit normale Blätter in einem Frame fertig sind. */
const FULL_BUDGET_MS = 32;
import { hitObj, objCorners, transformObj, type CanvasObj, type ImageObj } from "./objects";
import { recognize, densify, SHAPE_LABELS } from "../tools/shapes";
import {
  drawGuide, formatNumber, hitGuide, lengthFrom, makeGuide, sizeHandle, nearestEdge, rotateHandle, snapRotation, snapToCircle, snapToEdge,
  type EdgeSnap, type Guide, type GuideKind,
} from "../tools/guides";
import { MM, a4CamBounds, clampTo, rubber } from "./layout";
import type { BBox } from "@/lib/types";
import { PdfRaster } from "./pdf-raster";
import { getAsset } from "@/lib/api";
import { OneEuro, PressureSmoother, clampPressureEdges, minDistWorld } from "./ink-filter";
import { makeObj } from "./objects";
import type { MolData } from "@/features/chem/mol";
import { angleDeg, fmtDeg, type AngleSpec, type FillSpec, type Head, type LineSpec, type VecSpec } from "../vector/vec";
import { snapToTerminal, updateVecObj, vecLinePts, vecObj } from "../vector/vec-obj";
import { findRegion, paintRegion, type DrawWalls } from "../vector/fill";

export type Tool = "pen" | "eraser" | "lasso" | "pan" | "text" | "fill" | "angle" | "laser" | "vanish";
export const GUIDE_KINDS: GuideKind[] = ["ruler", "setsquare", "compass"];
export type EraserMode = "stroke" | "partial";

export interface ToolState {
  tool: Tool;
  /** Werkzeug, zu dem der Stift aus „Greifen“ zurückspringt (wie OneNote). */
  penTool?: Tool;
  pen: PenKind;
  color: string;
  width: number;
  eraserMode: EraserMode;
  /** Radius in Bildschirmpixeln. */
  eraserSize: number;
  /** Ein Finger zeichnet (sonst: verschiebt). */
  fingerDraws: boolean;
  /** Finger und Maus mit Zeichenwerkzeug: Tippen = Textfeld, Ziehen = Verschieben; danach gilt wieder das gewählte Werkzeug. */
  pointerGrab: boolean;
  /** Am Raster einrasten: Formen, Lineal-Striche und Zeichenhilfen springen auf Rasterpunkte. */
  gridSnap?: boolean;
  /** Dauerhafter Formmodus: jeder Strich wird, wenn möglich, zur Form. */
  shapeMode: boolean;
  /** Eingeblendete Zeichenhilfen. */
  guides: Record<GuideKind, boolean>;
  /** Deckkraft aus Stift-Preset (null/fehlt = Standard des Stifts). */
  opacity?: number | null;
  /** Pfeilspitzen für Linien (Lineal, Freihand → Form) */
  head0?: Head;
  head1?: Head;
  /** Füllwerkzeug: Deckkraft 0..1 und Schraffur (Winkel in Grad, Abstand in Welt) */
  fillOpacity?: number;
  fillHatch?: { angle: number; gap: number } | null;
  /** Verschwindende Tinte: Sichtbarkeit in ms */
  vanishMs?: number;
}

export interface SelectionInfo {
  count: number;
  /** IDs der ausgewählten Elemente; das erste ist der Anker (oben links) für Tags. */
  ids: string[];
  /** Bildschirm-Rechteck (CSS-Pixel relativ zum Host). */
  rect: BBox;
  color: string | null;
  /** Anzahl ausgewählter Striche bzw. Bilder (für Erkennung: Handschrift/Formel bzw. OCR). */
  strokes: number;
  images: number;
  /** Pfeilspitzen änderbar (Vektorlinien oder gerade Striche ausgewählt) */
  heads: { head0: Head; head1: Head } | null;
  /** Genau ein bearbeitbares Vektor-Element (Koordinatensystem, Zahlenstrahl …) */
  vec: VecSpec | null;
  /** Genau eine Strukturformel ausgewählt */
  mol: MolData | null;
}

export interface EngineEvents {
  onHistory?: (canUndo: boolean, canRedo: boolean) => void;
  onDirty?: () => void;
  /** Wird direkt aus dem Hot Path aufgerufen – nur DOM schreiben, kein React-State. */
  onCamera?: (scale: number) => void;
  onSelection?: (s: SelectionInfo | null) => void;
  /** Text-/Tabellenobjekte haben sich geändert (für die DOM-Ebene). */
  onObjects?: (objs: CanvasObj[]) => void;
  /** Textwerkzeug-Tipp oder Doppelklick/Doppeltipp auf freie Stelle (Weltkoordinaten). `free` = Alt gedrückt (kein Einrasten). */
  onTextAt?: (w: Vec, free: boolean) => void;
  /** Textfeld/Tabelle mit dem Finger angetippt (Bildschirmkoordinaten) → dort bearbeiten. */
  onObjTap?: (id: string, clientX: number, clientY: number) => void;
  /** Stift setzt bei „Greifen“ auf → Engine nutzt das zuletzt gewählte Stift-Werkzeug; Leiste soll umschalten. */
  onAutoTool?: (tool: Tool) => void;
  /** Radialmenü öffnen (Bildschirmkoordinaten relativ zum Host). */
  onRadial?: (p: Vec) => void;
  /** Maus über einem Text-/Tabellenobjekt (zeigt dessen Greifbalken), sonst null. */
  onHoverObj?: (id: string | null) => void;
  /** Freihand → Form erkannt. */
  onShape?: (label: string) => void;
  /** Kurzer Hinweis (z. B. Füllen nicht möglich). */
  onToast?: (msg: string) => void;
  /** Winkelmessung fertig (Bildschirmposition des Scheitels) bzw. zurückgesetzt (null). */
  onAngle?: (a: { deg: number; at: Vec } | null) => void;
}

type Mode = "idle" | "draw" | "erase" | "lasso" | "transform" | "pan" | "gesture" | "guide" | "tap";

interface GuideDrag {
  g: Guide;
  kind: "move" | "rotate" | "radius" | "two" | "length";
  start: Vec;
  gx: number;
  gy: number;
  angle: number;
  a0: number;
  /** Zwei-Finger: Finger-IDs und Startmitte. */
  ids?: [number, number];
  mid?: Vec;
}

const HOLD_MS = 500;
/** Stift: so lange am Strichende stillhalten, bis Formerkennung greift (Pausen beim Schreiben ≠ Form). */
const PEN_SHAPE_HOLD_MS = 750;
/** Vorhersage höchstens so weit (Bildschirmpixel) vor den echten Punkt. */
const PRED_MAX_PX = 4;
const HOLD_SLOP = 5;
type Handle = "move" | "scale" | "rotate";

const HANDLE_R = 22; // Trefferradius ≥ 44 px Durchmesser
const ROT_OFFSET = 36;
const TAP_MS = 350;
const TAP_SLOP = 12;
const DOUBLE_TAP_MS = 400;

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
  objs: ImageObj[];
  bbox: BBox;
  center: Vec;
  tx: number;
  ty: number;
  theta: number;
  s: number;
}

/** „Alles anzeigen“ zoomt bei wenig Inhalt nicht weiter hinein. */
const FIT_MAX_ZOOM = 2;

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
    eraserMode: "stroke", eraserSize: 14, fingerDraws: true, pointerGrab: true, shapeMode: false,
    guides: { ruler: false, setsquare: false, compass: false },
  };

  // Zeichenhilfen
  private guides = new Map<GuideKind, Guide>();
  private gd: GuideDrag | null = null;
  private snap: { g: Guide; edge?: EdgeSnap; r?: number } | null = null;

  // Halten (Form / Radialmenü)
  private holdTimer = 0;
  private holdT = 0;
  private holdPos: Vec = { x: 0, y: 0 };
  private downPos: Vec = { x: 0, y: 0 };
  private maxFromDown = 0;
  private shaped = false;
  private barrel = false;
  private downT = 0;

  // Objekte
  private objLayer: HTMLElement | null = null;
  private images = new Map<string, HTMLImageElement>();

  // Eingabe
  private palm = new PalmRejection();
  private mode: Mode = "idle";
  private activeId = -1;
  private activeType = "";
  private rect: DOMRect | null = null;
  private touches = new Map<number, Vec>();
  /** Positionen von Fingern, die erst mit einem zweiten Finger zur Geste werden (Stift-Nachlaufzeit). */
  private pendingTouch = new Map<number, Vec>();
  private hover: Vec | null = null;
  private hoverEraser = false;

  // Strich
  private pts = new Points();
  private pred = new Points();
  private t0 = 0;
  private livePen: PenKind = "fountain";
  private liveColor = "#000";
  private liveWidth = 2;
  private liveOpacity = 1;
  private livePressure = false;
  private smooth = new PressureSmoother();
  private posFilter = new OneEuro();
  private readonly fpt = { x: 0, y: 0 };
  private lastP = 0.5;
  private rawSeen = false;
  private inkDebug = false;
  private dbg: { pts: Float32Array; n: number; pen: PenKind; width: number; pressure: boolean } | null = null;

  // Neue Werkzeuge (Füllen, Winkel, Laser, verschwindende Tinte, Pfeilspitzen)
  private tapTool: Tool | null = null;
  private ephemeral: "laser" | "vanish" | null = null;
  private fading: { t: number; s: Stroke }[] = [];
  private laserTail: { t: number; pts: Float32Array } | null = null;
  private shapeVec: { a: Vec; b: Vec; head0: Head; head1: Head } | null = null;
  private anglePts: Vec[] = [];
  private angleLines: { a: Vec; b: Vec; tap: Vec }[] = [];
  private angleHover: Vec | null = null;
  private angleDone: { a: Vec; b: Vec; c: Vec } | null = null;

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
    if (RAW) a.addEventListener("pointerrawupdate" as "pointermove", this.onRaw);
    a.addEventListener("pointerup", this.onUp);
    a.addEventListener("pointercancel", this.onCancel);
    a.addEventListener("pointerleave", this.onLeave);
    a.addEventListener("wheel", this.onWheel, { passive: false });
    a.addEventListener("contextmenu", this.onContext);
    a.addEventListener("touchstart", prevent, { passive: false });
    this.store.onApply = this.onApply;
    // Fertige PDF-Kacheln: einmal pro Frame betroffene Tiles an Ort und Stelle neu zeichnen (kein Aufblitzen)
    this.pdf.onReady = (asset, page) => {
      this.pdfReady.add(asset + "|" + page);
      this.baseDirty = true;
      this.request();
    };
    this.store.onHistory = () => this.events.onHistory?.(this.store.canUndo, this.store.canRedo);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  destroy() {
    this.perf = null;
    this.pdf.destroy();
    clearTimeout(this.settleTimer);
    cancelAnimationFrame(this.settleRaf);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.rescaleTimer);
    this.ro.disconnect();
    const a = this.active;
    a.removeEventListener("pointerdown", this.onDown);
    a.removeEventListener("pointermove", this.onMove);
    if (RAW) a.removeEventListener("pointerrawupdate" as "pointermove", this.onRaw);
    a.removeEventListener("pointerup", this.onUp);
    a.removeEventListener("pointercancel", this.onCancel);
    a.removeEventListener("pointerleave", this.onLeave);
    a.removeEventListener("wheel", this.onWheel);
    a.removeEventListener("contextmenu", this.onContext);
    clearTimeout(this.holdTimer);
    a.removeEventListener("touchstart", prevent);
  }

  // ================= Öffentliche API =================

  load(strokes: Stroke[], objects: CanvasObj[] = []) {
    this.store.load(strokes, objects);
    this.recomputeBottom();
    this.tiles.clear();
    this.invalidate(true);
    this.events.onObjects?.(this.store.objects());
  }

  /** DOM-Ebene für Text/Tabellen; die Engine setzt nur ihren Kamera-Transform. */
  setObjectLayer(el: HTMLElement | null) {
    // Zoomen/Scrollen auch, wenn der Mauszeiger über einem Textfeld/einer Tabelle steht
    this.objLayer?.removeEventListener("wheel", this.onWheel);
    el?.addEventListener("wheel", this.onWheel, { passive: false });
    this.objLayer = el;
    this.applyLayerTransform();
  }

  /** Weltkoordinaten der Ansichtsmitte. */
  viewCenter(): Vec {
    return this.toWorld(this.W / 2, this.H / 2);
  }

  /** Bildschirm (relativ zum Host) → Welt. */
  screenToWorld(p: Vec): Vec {
    return this.toWorld(p.x, p.y);
  }

  worldToScreen(p: Vec): Vec {
    return this.toScreen(p.x, p.y);
  }

  get viewWidth() {
    return this.W / this.cam.s;
  }

  addObject(o: CanvasObj) {
    this.commitSelection();
    this.store.commit({ add: [], remove: [], addObj: [o] });
    if (o.kind === "image" && !o.data.locked) this.select([], [o]);
  }

  /** Mehrere Objekte in einem Rückgängig-Schritt (z. B. PDF-Seiten). */
  addObjects(objs: CanvasObj[]) {
    if (!objs.length) return;
    this.commitSelection();
    this.store.commit({ add: [], remove: [], addObj: objs });
  }

  /** Begrenzung aller Inhalte (Welt) oder null bei leerem Blatt. */
  contentBounds(): BBox | null {
    const strokes = this.store.all(), objs = this.store.objects();
    return strokes.length || objs.length ? unionAll(strokes, objs) : null;
  }

  /** BBox eines Strichs oder Objekts. */
  elementBBox(id: string): BBox | null {
    return (this.store.get(id) ?? this.store.getObj(id))?.bbox ?? null;
  }

  /** Kamera auf einen Weltbereich zentrieren (Zoom bleibt, außer der Bereich passt nicht). */
  focusOn(r: BBox) {
    this.fitted = true;
    const s = clampZoom(Math.min(this.cam.s, (this.W - 96) / Math.max(1, r.w), (this.H - 96) / Math.max(1, r.h)));
    this.cam = { s, x: r.x + r.w / 2 - this.W / 2 / s, y: r.y + r.h / 2 - this.H / 2 / s };
    this.cameraChanged(true);
  }

  /** Aktuelle Seiteneinstellungen + Anzahl A4-Seiten (für Export/Wiedergabe). */
  get pageInfo() {
    return { setup: this.setup, pageCount: this.pageCount, dark: this.pal.dark };
  }

  /** Live-Änderung ohne Verlauf (z. B. beim Tippen). */
  updateObjectLive(o: CanvasObj) {
    const old = this.store.getObj(o.id);
    this.store.applyRaw({ add: [], remove: [], removeObj: old ? [old] : [], addObj: [o] });
  }

  /** Abgeschlossene Bearbeitung in den Verlauf legen. */
  recordObjectEdit(before: CanvasObj, after: CanvasObj) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.store.record({ add: [], remove: [], removeObj: [before], addObj: [after] });
  }

  removeObject(id: string) {
    const o = this.store.getObj(id);
    if (o) this.store.commit({ add: [], remove: [], removeObj: [o] });
  }

  nextZ() {
    return this.store.nextZ();
  }

  // ---- Eingabe-Einstellungen aus dem Assistenten ----
  private input = { gamma: 1, pmax: 1, barrel: "lasso" as "lasso" | "eraser" | "radial" };

  /** Druckkurve (kalibriert) und Belegung der Stifttaste. */
  setInput(o: Partial<{ gamma: number; pmax: number; barrel: "lasso" | "eraser" | "radial" }>) {
    Object.assign(this.input, o);
  }

  private curve(p: number) {
    const v = Math.min(1, p / Math.max(0.05, this.input.pmax));
    return this.input.gamma === 1 ? v : Math.pow(v, this.input.gamma);
  }

  pageSetup(): PageSetup {
    return this.setup;
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
    for (const k of GUIDE_KINDS) {
      const on = !!t.guides?.[k];
      if (on && !this.guides.has(k)) {
        const c = this.viewCenter();
        const off = k === "setsquare" ? { x: 0, y: -40 } : k === "compass" ? { x: 0, y: 60 } : { x: 0, y: 0 };
        this.guides.set(k, makeGuide(k, { x: c.x + off.x / this.cam.s, y: c.y + off.y / this.cam.s }));
      } else if (!on) this.guides.delete(k);
    }
    if (t.tool !== "angle" && (this.anglePts.length || this.angleLines.length || this.angleDone)) this.resetAngle();
    this.tool = { ...t, guides: { ...t.guides } };
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
    this.softBounds();
    this.cameraChanged(true);
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.settle(), 140);
  }

  // ---- A4-Grenzen: weiches Abbremsen am Rand, danach zurückfedern ----
  private panRaw: Vec = { x: 0, y: 0 };
  private settleTimer = 0;
  private settleRaf = 0;

  private camBounds() {
    if (this.setup.mode !== "a4" || !this.W) return null;
    return a4CamBounds(this.setup.orientation, this.pageCount, this.W / this.cam.s, this.H / this.cam.s);
  }

  private softBounds() {
    const b = this.camBounds();
    if (!b) return;
    cancelAnimationFrame(this.settleRaf);
    this.settleRaf = 0;
    const dx = this.W / this.cam.s / 4, dy = this.H / this.cam.s / 4;
    this.cam.x = rubber(this.cam.x, b.minX, b.maxX, dx);
    this.cam.y = rubber(this.cam.y, b.minY, b.maxY, dy);
  }

  /** Nach dem Loslassen weich in den erlaubten Bereich zurück (rAF, keine Timer-Schleife). */
  private settle() {
    const b = this.camBounds();
    if (!b) return;
    cancelAnimationFrame(this.settleRaf);
    const step = () => {
      const tx = clampTo(this.cam.x, b.minX, b.maxX), ty = clampTo(this.cam.y, b.minY, b.maxY);
      const ex = tx - this.cam.x, ey = ty - this.cam.y;
      if (Math.abs(ex) * this.cam.s < 0.5 && Math.abs(ey) * this.cam.s < 0.5) {
        this.settleRaf = 0;
        if (ex || ey) { this.cam.x = tx; this.cam.y = ty; this.cameraChanged(true); }
        return;
      }
      this.cam.x += ex * 0.22;
      this.cam.y += ey * 0.22;
      this.cameraChanged(true);
      this.settleRaf = requestAnimationFrame(step);
    };
    this.settleRaf = requestAnimationFrame(step);
  }

  zoomBy(f: number) {
    this.zoomTo(this.cam.s * f);
  }

  /** Alles anzeigen: Kamera so, dass alle Inhalte mit Rand sichtbar sind (höchstens 200 %).
   *  Leeres Blatt → Startansicht. Weicher Übergang (rAF, ~250 ms). */
  fitContent() {
    if (!this.W) return;
    const r = this.contentBounds();
    let to: { s: number; x: number; y: number };
    if (!r) {
      const cur = this.cam;
      this.fitted = false;
      this.fit();
      to = this.cam;
      this.cam = cur;
    } else {
      const pad = 48;
      const s = clampZoom(Math.min(FIT_MAX_ZOOM, (this.W - 2 * pad) / Math.max(1, r.w), (this.H - 2 * pad) / Math.max(1, r.h)));
      to = { s, x: r.x + r.w / 2 - this.W / 2 / s, y: r.y + r.h / 2 - this.H / 2 / s };
    }
    this.fitted = true;
    this.animateCam(to);
  }

  private camRaf = 0;
  private animateCam(to: { s: number; x: number; y: number }) {
    cancelAnimationFrame(this.camRaf);
    cancelAnimationFrame(this.settleRaf);
    const from = { ...this.cam }, t0 = performance.now(), dur = 260;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Mittelpunkt (Bildschirm) und Zoom (logarithmisch) interpolieren → keine Schlingerbewegung
    const cx = (c: typeof from) => c.x + this.W / 2 / c.s, cy = (c: typeof from) => c.y + this.H / 2 / c.s;
    const step = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      const mx = cx(from) + (cx(to) - cx(from)) * e, my = cy(from) + (cy(to) - cy(from)) * e;
      this.cam = { s, x: mx - this.W / 2 / s, y: my - this.H / 2 / s };
      this.cameraChanged(true);
      this.camRaf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    this.camRaf = requestAnimationFrame(step);
  }

  /** Seiten des Blatts: DIN-A4-Seiten bzw. importierte PDF-Seiten (Weltkoordinaten). */
  private pageRects(): BBox[] {
    const out: BBox[] = [];
    if (this.setup.mode === "a4") for (let i = 0; i < this.pageCount; i++) out.push(a4PageRect(i, this.setup.orientation));
    for (const o of this.store.objects()) if (o.kind === "image" && o.data.locked) out.push({ x: o.x, y: o.y, w: o.w, h: o.h });
    return out;
  }

  /** Seite in Bildschirmmitte (sonst die nächstgelegene). */
  private pageAtCenter(): BBox | null {
    const cx = this.cam.x + this.W / 2 / this.cam.s, cy = this.cam.y + this.H / 2 / this.cam.s;
    let best: BBox | null = null, bd = Infinity;
    for (const r of this.pageRects()) {
      const dx = Math.max(r.x - cx, 0, cx - r.x - r.w), dy = Math.max(r.y - cy, 0, cy - r.y - r.h);
      const d = Math.hypot(dx, dy) - (dx === 0 && dy === 0 ? r.w * r.h * 1e-9 : 0);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  private camFor(r: BBox, how: "page" | "width") {
    const pad = 16;
    const sw = (this.W - 2 * pad) / Math.max(1, r.w), sh = (this.H - 2 * pad) / Math.max(1, r.h);
    const s = clampZoom(how === "page" ? Math.min(sw, sh) : sw);
    // Ganze Seite: zentriert; Seitenbreite: oberen Rand der Seite zeigen (bzw. aktuelle Höhe halten)
    const cy = this.cam.y + this.H / 2 / this.cam.s;
    const y = how === "page" ? r.y + r.h / 2 - this.H / 2 / s
      : Math.min(Math.max(cy - this.H / 2 / s, r.y - pad / s), r.y + r.h - this.H / s + pad / s);
    return { s, x: r.x + r.w / 2 - this.W / 2 / s, y };
  }

  /** Seite (auch PDF-Seite) an den Bildschirm anpassen. Erneut drücken wechselt ganze Seite ↔ Seitenbreite.
   *  Ohne Seiten → wie „Alles anzeigen“. */
  fitPage(): "page" | "width" | null {
    if (!this.W) return null;
    const r = this.pageAtCenter();
    if (!r) { this.fitContent(); return null; }
    const page = this.camFor(r, "page");
    const how = Math.abs(this.cam.s - page.s) / page.s < 0.02 && Math.abs(page.s - this.camFor(r, "width").s) > 1e-3 ? "width" : "page";
    this.fitted = true;
    this.animateCam(how === "page" ? page : this.camFor(r, "width"));
    return how;
  }

  /** Start-Zoom nach dem Laden: erste Seite (A4/PDF) auf Bildschirmbreite (höchstens 160 %). */
  initialFit() {
    if (!this.W) return;
    const rs = this.pageRects().sort((a, b) => a.y - b.y || a.x - b.x);
    const r = rs[0];
    if (!r) return;
    const pad = 16;
    const s = clampZoom(Math.min(1.6, (this.W - 2 * pad) / Math.max(1, r.w)));
    this.fitted = true;
    this.cam = { s, x: r.x + r.w / 2 - this.W / 2 / s, y: r.y - pad / s };
    this.cameraChanged(true);
  }

  resetView() {
    this.fitted = false;
    this.fit();
    this.cameraChanged(true);
  }

  // ---- Auswahl-Aktionen ----

  /** Gerade wird gezeichnet/radiert/verschoben (Speichern dann zurückstellen). */
  get inputActive() {
    return this.mode !== "idle" && this.mode !== "gesture" ? true : performance.now() - this.lastUpAt < 250;
  }

  get hasSelection() {
    return !!this.sel;
  }

  recolorSelection(color: string) {
    const sel = this.sel;
    if (!sel) return;
    const m = this.selMatrix();
    const next = sel.strokes.map((s) => ({ ...transformStroke(s, m), color }));
    const objs = sel.objs.map((o) => {
      const t = transformObj(o, m);
      return t.data.vec && t.data.vec.t !== "fill" ? updateVecObj(t, { ...t.data.vec, color } as VecSpec) : t;
    });
    this.store.commit({ remove: sel.strokes, add: next, removeObj: sel.objs, addObj: objs });
    this.select(next, objs);
  }

  duplicateSelection() {
    const sel = this.sel;
    if (!sel) return;
    const m = this.selMatrix();
    const baked = sel.strokes.map((s) => transformStroke(s, m));
    const bakedO = sel.objs.map((o) => transformObj(o, m));
    if (!isIdentity(m)) this.store.commit({ remove: sel.strokes, add: baked, removeObj: sel.objs, addObj: bakedO });
    this.unhide();
    const off: Mat = [1, 0, 0, 1, 24 / this.cam.s, 24 / this.cam.s];
    const copies = baked.map((s) => ({ ...transformStroke(s, off, false), z: this.store.nextZ() }));
    const copiesO = bakedO.map((o) => ({ ...transformObj(o, off, uid()), z: this.store.nextZ() }));
    this.store.commit({ remove: [], add: copies, addObj: copiesO });
    this.select(copies, copiesO);
  }

  /** Ausgewählte Schrift (Transformation eingerechnet, ohne Textmarker) für die Erkennung. */
  selectionInk(): { points: Float32Array[]; boxes: BBox[]; bbox: BBox; images: ImageObj[] } | null {
    const sel = this.sel;
    if (!sel) return null;
    const m = this.selMatrix();
    const strokes = sel.strokes.filter((s) => s.pen !== "highlighter").map((s) => (isIdentity(m) ? s : transformStroke(s, m)));
    const images = sel.objs.map((o) => (isIdentity(m) ? o : transformObj(o, m)));
    const all = [...strokes, ...images];
    if (!all.length) return null;
    return { points: strokes.map((s) => s.points), boxes: strokes.map((s) => computeBBox(s.points, 0)), bbox: unionAll(strokes, images), images };
  }

  /** Auswahl durch Objekte ersetzen (ein Undo-Schritt); `keep` behält die Striche. */
  replaceSelection(objs: CanvasObj[], keep = false) {
    const sel = this.sel;
    if (!sel) return;
    if (keep) this.commitSelection();
    else {
      this.sel = null;
      this.unhide();
    }
    this.store.commit(keep ? { add: [], remove: [], addObj: objs } : { remove: sel.strokes, add: [], removeObj: sel.objs, addObj: objs });
    this.emitSelection();
  }

  /** Ausgewähltes Bild ersetzen (ein Undo-Schritt) und das neue auswählen (z. B. bearbeiteter Graph). */
  replaceSelectedImage(o: ImageObj) {
    this.replaceSelection([o]);
    this.select([], [o]);
  }

  deleteSelection() {
    const sel = this.sel;
    if (!sel) return;
    this.sel = null;
    this.unhide();
    this.store.commit({ remove: sel.strokes, add: [], removeObj: sel.objs });
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
      const objs = sel.objs.map((o) => transformObj(o, m));
      this.unhide();
      this.store.commit({ remove: sel.strokes, add: next, removeObj: sel.objs, addObj: objs });
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
      const s = clampZoom(Math.min(1.6, (this.W - 32) / w)); // Seitenbreite, nicht winzig auf großen Bildschirmen
      this.cam = { s, x: -(this.W / s - w) / 2, y: -16 / s };
    } else {
      this.cam = { s: 1, x: 0, y: 0 };
    }
    this.tiles.clear(this.cam.s * this.dpr);
    this.events.onCamera?.(this.cam.s);
    this.applyLayerTransform();
  }

  private applyLayerTransform() {
    const el = this.objLayer;
    if (!el) return;
    const { x, y, s } = this.cam;
    el.style.transform = `matrix(${s},0,0,${s},${-x * s},${-y * s})`;
    el.style.setProperty("--zoom", String(s));
  }

  private cameraChanged(rescaleSoon: boolean) {
    this.events.onCamera?.(this.cam.s);
    this.applyLayerTransform();
    const target = this.cam.s * this.dpr;
    const ratio = target / this.tiles.scale;
    if (ratio > 2 || ratio < 0.5) this.rescaleNow = true; // zu weit weg → sofort neu
    if (rescaleSoon && ratio !== 1) {
      clearTimeout(this.rescaleTimer);
      this.rescaleTimer = window.setTimeout(() => {
        this.rescaleNow = true;
        this.invalidate(true);
        this.emitSelection();
      }, 150); // nach 150 ms Ruhe in der scharfen Stufe neu rendern
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
    const objChanged = !!(c.addObj?.length || c.removeObj?.length);
    if (objChanged) {
      for (const o of [...(c.removeObj ?? []), ...(c.addObj ?? [])]) if (o.kind === "image") this.tiles.invalidate(o.bbox);
      if ([...(c.removeObj ?? []), ...(c.addObj ?? [])].some((o) => o.kind !== "image")) this.events.onObjects?.(this.store.objects());
      for (const o of c.addObj ?? []) this.contentBottom = Math.max(this.contentBottom, o.bbox.y + o.bbox.h);
    }
    // Reines Hinzufügen ohne Textmarker → direkt auf vorhandene Tiles zeichnen.
    const additive = !c.removeObj?.length && c.remove.length === 0 && c.add.every((s) => s.pen !== "highlighter" && !this.hidden.has(s.id));
    if (additive) {
      for (const s of c.add) this.paintOnTiles(s);
    } else {
      for (const s of c.remove) this.tiles.invalidate(s.bbox);
      for (const s of c.add) this.tiles.invalidate(s.bbox);
    }
    if (c.remove.length || c.removeObj?.length) this.recomputeBottom();
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
    for (const o of this.store.objects()) b = Math.max(b, o.bbox.y + o.bbox.h);
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
    if (e.pointerType === "touch" && e.isPrimary) {
      // Kein anderer Finger liegt mehr auf: hängengebliebene Kontakte (pointerup außerhalb verpasst) verwerfen
      this.touches.clear();
      this.pendingTouch.clear();
      if (this.mode === "gesture") this.mode = "idle";
    }
    const decision = this.palm.onDown(e.pointerType, e.pointerId, now, Math.max(e.width || 0, e.height || 0), e.pointerType === "touch" && e.isPrimary);
    if (e.pointerType === "touch") {
      if (decision === "ignore") {
        if (this.palm.isPending(e.pointerId)) this.pendingTouch.set(e.pointerId, p);
        return; // Handballen: weder zeichnen noch Geste
      }
      this.touches.set(e.pointerId, p);
      for (const id of this.palm.takePromoted()) {
        const q = this.pendingTouch.get(id);
        if (q) this.touches.set(id, q);
      }
      this.pendingTouch.clear();
    }
    // Stift setzt auf, während ein Finger/Handballen gerade etwas tut → Finger-Aktion verwerfen, Stift gewinnt
    if (e.pointerType === "pen" && this.mode !== "idle" && this.activeType === "touch") this.abortTouch();

    if (e.pointerType === "touch" && this.touches.size >= 2) {
      if (this.mode === "guide" && this.activeType === "touch") return this.beginGuideTwo();
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
    const barrelTool: Tool = this.input.barrel === "eraser" ? "eraser" : "lasso";
    let tool: Tool = penEraser ? "eraser" : penBarrel ? barrelTool : this.tool.tool;
    if (e.pointerType === "mouse" && e.button === 1) tool = "pan";
    // OneNote: „Greifen“ ist Standard; setzt der Stift auf, springt er zum zuletzt gewählten Stift-Werkzeug zurück
    if (e.pointerType === "pen" && !penEraser && !penBarrel && tool === "pan") {
      tool = this.tool.penTool && this.tool.penTool !== "pan" ? this.tool.penTool : "pen";
      this.tool = { ...this.tool, tool };
      this.updateBlend();
      this.events.onAutoTool?.(tool);
    }
    const drawing = tool === "pen" || tool === "eraser" || tool === "laser" || tool === "vanish";
    const fingerOrClick = e.pointerType === "touch" || (e.pointerType === "mouse" && e.button === 0);
    // Tippen (Finger) und Klicken (Maus) verhalten sich gleich: bei Zeichenwerkzeugen (Option) und immer bei „Greifen“
    this.grabTap = ((this.tool.pointerGrab && drawing) || tool === "pan") && !penEraser && !penBarrel && fingerOrClick;
    const fingerPans = this.grabTap || (e.pointerType === "touch" && !this.tool.fingerDraws && tool !== "pan");
    if (fingerPans) tool = "pan";
    this.barrel = penBarrel;
    if (penBarrel && this.input.barrel === "radial") {
      // Stifttaste → Radialmenü sofort
      this.activeId = -1;
      this.events.onRadial?.(q);
      return;
    }
    this.downT = now;
    this.downPos = q;
    this.holdPos = q;
    this.holdT = now;
    this.maxFromDown = 0;
    this.snap = null;

    // Zeichenhilfen: Kante anlegen, verschieben, drehen
    if (tool !== "pan" || fingerPans) {
      const w = this.toWorld(q.x, q.y);
      const r = this.guideAt(w, tool === "pen" && !fingerPans);
      if (r === "snap") return this.beginStroke(e, q);
      if (r) return this.beginGuideDrag(r.g, r.kind, w);
    }

    // Schloss über einem gesperrten Element → entsperren
    const lk = this.lockBadgeAt(q);
    if (lk) {
      this.unlockObject(lk.id);
      this.endPointer();
      return;
    }

    // Greifbalken über einem Bild/PDF-Element → aufnehmen und verschieben (jedes Werkzeug)
    const grip = this.gripAt(q);
    if (grip) {
      this.select([], [grip]);
      return this.beginTransform("move", q);
    }

    // Auswahl-Griffe haben Vorrang (Lasso-Auswahl lässt sich mit jedem Werkzeug direkt ziehen)
    if (this.sel && (tool !== "pan" || this.grabTap)) {
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
        this.panRaw = { x: this.cam.x, y: this.cam.y };
        if (e.pointerType === "touch") this.armHold();
        return;
      case "text":
        this.mode = "tap";
        return;
      case "fill":
      case "angle":
        this.mode = "tap";
        this.tapTool = tool;
        return;
      case "laser":
      case "vanish":
        this.ephemeral = tool;
        return this.beginStroke(e, q);
    }
  };

  private onContext = (e: MouseEvent) => {
    e.preventDefault();
    if (this.mode !== "idle") return;
    this.rect = this.active.getBoundingClientRect();
    const q = { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
    // Rechtsklick/langes Drücken auf ein Bild/PDF: auswählen → Auswahlmenü (Kontextmenü des Elements)
    const o = this.topObjAt(this.toWorld(q.x, q.y));
    if (o?.kind === "image") {
      this.select([], [o]);
      return;
    }
    if (o) {
      this.events.onHoverObj?.(o.id);
      return;
    }
    if (this.sel) return this.emitSelection();
    this.events.onRadial?.(q);
  };

  /** Bewegung für Halten-Erkennung verfolgen (ohne Timer pro Event). */
  private trackHold(q: Vec) {
    const d = Math.hypot(q.x - this.downPos.x, q.y - this.downPos.y);
    if (d > this.maxFromDown) this.maxFromDown = d;
    if (Math.hypot(q.x - this.holdPos.x, q.y - this.holdPos.y) > HOLD_SLOP) {
      this.holdPos = q;
      this.holdT = performance.now();
    }
  }

  private armHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(this.onHoldTick, HOLD_MS);
  }

  private onHoldTick = () => {
    this.holdTimer = 0;
    if (this.mode !== "draw" && this.mode !== "pan") return;
    const idle = performance.now() - this.holdT;
    const need = this.mode === "draw" && this.activeType === "pen" ? PEN_SHAPE_HOLD_MS : HOLD_MS;
    if (idle < need - 8) {
      this.holdTimer = window.setTimeout(this.onHoldTick, need - idle);
      return;
    }
    this.onHold();
  };

  private onHold() {
    const still = this.maxFromDown < HOLD_SLOP * 2;
    // Finger lange gedrückt auf einem Element → aufnehmen
    if (still && this.mode === "pan" && this.activeType === "touch") {
      const w = this.toWorld(this.downPos.x, this.downPos.y);
      const o = this.topObjAt(w);
      if (o && o.kind === "image") {
        this.select([], [o]);
        navigator.vibrate?.(15);
        return this.beginTransform("move", this.downPos);
      }
      if (o) {
        this.events.onHoverObj?.(o.id);
        return;
      }
    }
    // Stift: kein Radialmenü durch Stillhalten (dafür gibt es die Stifttaste) – sonst geht ein fester Punkt
    // oder ein aufgesetzter, „nachdenkender“ Stift samt Tinte verloren
    if (still && this.mode === "draw" && this.activeType === "pen") return this.armHold();
    if (still && (this.mode === "pan" || (this.mode === "draw" && !this.snap))) {
      // Long-Press → Radialmenü
      this.pts.n = 0;
      this.pred.n = 0;
      const at = this.downPos;
      this.endPointer();
      this.events.onRadial?.(at);
      return;
    }
    if (this.mode === "draw" && !this.shaped && !this.snap) {
      if (this.applyShape()) {
        this.activeDirty = true;
        this.request();
      } else this.armHold(); // weiter beobachten
    }
  }

  /** Aktuellen Strich durch erkannte Form ersetzen. */
  private applyShape(): boolean {
    const pts: Vec[] = [];
    const d = this.pts.data;
    for (let i = 0; i < this.pts.n; i++) pts.push({ x: d[i * PSTRIDE], y: d[i * PSTRIDE + 1] });
    const shape = recognize(pts);
    if (!shape) return false;
    if (this.gridOn()) {
      if (shape.kind === "circle" || shape.kind === "ellipse") {
        // Mittelpunkt aufs Raster, Radius auf ganze Rasterschritte
        const n = shape.points.length;
        const c = shape.points.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });
        const g = this.toGrid(c), st = this.gridStep();
        const f = (d: number) => Math.max(st, Math.round(d / st) * st) / Math.max(1e-6, d);
        const rx = Math.max(...shape.points.map((p) => Math.abs(p.x - c.x))), ry = Math.max(...shape.points.map((p) => Math.abs(p.y - c.y)));
        const sx = f(rx), sy = shape.kind === "circle" ? sx : f(ry);
        shape.points = shape.points.map((p) => ({ x: g.x + (p.x - c.x) * sx, y: g.y + (p.y - c.y) * sy }));
      } else if (shape.kind !== "arrow") {
        shape.points = shape.points.map((p) => this.toGrid(p));
      } else {
        const d = this.toGrid(shape.points[0]);
        const dx = d.x - shape.points[0].x, dy = d.y - shape.points[0].y;
        shape.points = shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
    }
    const h0 = this.tool.head0 ?? "none", h1 = this.tool.head1 ?? "none";
    const nearTerminal = shape.kind === "line" && this.store.objects().some((o) => o.kind === "image" && o.data.vec?.t === "symbol" &&
      [shape.points[0], shape.points[1]].some((p) => snapToTerminal(p, [o], 16 / this.cam.s) !== p));
    if (!this.ephemeral && (shape.kind === "arrow" || nearTerminal || (shape.kind === "line" && (h0 !== "none" || h1 !== "none")))) {
      this.shapeVec = { a: shape.points[0], b: shape.points[1], head0: h0, head1: shape.kind === "arrow" && h1 === "none" ? "filled" : h1 };
    }
    const dense = densify(shape.points, Math.max(1.5, 3 / this.cam.s));
    this.pts.n = 0;
    this.pred.n = 0;
    dense.forEach((v, i) => this.pts.push(v.x, v.y, 0.5, 0, i * 4));
    this.shaped = true;
    this.livePressure = true;
    this.events.onShape?.(SHAPE_LABELS[shape.kind]);
    return true;
  }

  // ---- Zeichenhilfen ----

  /** Trifft w eine Zeichenhilfe? "snap" = Stift an Kante/Zirkel anlegen. */
  private guideAt(w: Vec, drawing: boolean): "snap" | { g: Guide; kind: GuideDrag["kind"] } | null {
    if (!this.guides.size) return null;
    const tol = 22 / this.cam.s;
    const compass = this.guides.get("compass");
    if (compass) {
      if (Math.hypot(w.x - compass.x, w.y - compass.y) <= tol) return { g: compass, kind: "move" };
      const tip = rotateHandle(compass);
      if (Math.hypot(w.x - tip.x, w.y - tip.y) <= tol) return { g: compass, kind: "radius" };
    }
    for (const k of ["setsquare", "ruler"] as const) {
      const g = this.guides.get(k);
      if (!g) continue;
      if (drawing) {
        const edge = nearestEdge(g, w, 18 / this.cam.s);
        if (edge) {
          this.snap = { g, edge };
          return "snap";
        }
      }
      const rh = rotateHandle(g);
      if (Math.hypot(w.x - rh.x, w.y - rh.y) <= tol) return { g, kind: "rotate" };
      const sz = sizeHandle(g);
      if (sz && Math.hypot(w.x - sz.x, w.y - sz.y) <= tol) return { g, kind: "length" };
      if (hitGuide(g, w)) return { g, kind: "move" };
    }
    if (compass && drawing) {
      const r = Math.max(2 * MM, Math.hypot(w.x - compass.x, w.y - compass.y));
      compass.r = r;
      this.snap = { g: compass, r };
      return "snap";
    }
    return null;
  }

  private beginGuideDrag(g: Guide, kind: GuideDrag["kind"], w: Vec) {
    this.mode = "guide";
    this.gd = { g, kind, start: w, gx: g.x, gy: g.y, angle: g.angle, a0: Math.atan2(w.y - g.y, w.x - g.x) };
    this.invalidate(false);
  }

  private beginGuideTwo() {
    const gd = this.gd;
    if (!gd) return;
    const it = this.touches.entries();
    const a = it.next().value!, b = it.next().value!;
    gd.kind = "two";
    gd.ids = [a[0], b[0]];
    gd.mid = this.toWorld((a[1].x + b[1].x) / 2, (a[1].y + b[1].y) / 2);
    gd.a0 = Math.atan2(b[1].y - a[1].y, b[1].x - a[1].x);
    gd.gx = gd.g.x;
    gd.gy = gd.g.y;
    gd.angle = gd.g.angle;
  }

  private updateGuide(q: Vec) {
    const gd = this.gd;
    if (!gd) return;
    const g = gd.g;
    const w = this.toWorld(q.x, q.y);
    if (gd.kind === "move") {
      g.x = gd.gx + w.x - gd.start.x;
      g.y = gd.gy + w.y - gd.start.y;
      if (this.gridOn()) { const p = this.toGrid(g); g.x = p.x; g.y = p.y; }
    } else if (gd.kind === "rotate") {
      g.angle = snapRotation(gd.angle + Math.atan2(w.y - g.y, w.x - g.x) - gd.a0);
    } else if (gd.kind === "length") {
      g.len = lengthFrom(g, w);
    } else if (gd.kind === "radius") {
      g.r = Math.max(2 * MM, Math.hypot(w.x - g.x, w.y - g.y));
      if (this.gridOn()) g.r = Math.max(this.gridStep(), Math.round(g.r / this.gridStep()) * this.gridStep());
      g.angle = Math.atan2(w.y - g.y, w.x - g.x);
    }
    this.invalidate(false);
  }

  private updateGuideTwo() {
    const gd = this.gd;
    if (!gd?.ids || !gd.mid) return;
    const a = this.touches.get(gd.ids[0]), b = this.touches.get(gd.ids[1]);
    if (!a || !b) return;
    const mid = this.toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    const g = gd.g;
    const angle = snapRotation(gd.angle + Math.atan2(b.y - a.y, b.x - a.x) - gd.a0);
    const d = angle - gd.angle, c = Math.cos(d), s = Math.sin(d);
    const rx = gd.gx - gd.mid.x, ry = gd.gy - gd.mid.y;
    g.x = mid.x + rx * c - ry * s;
    g.y = mid.y + rx * s + ry * c;
    g.angle = angle;
    this.invalidate(false);
  }

  /** Zirkel/Lineal-Info während des Zeichnens. */
  private snapLabel(): string | undefined {
    if (!this.snap || this.mode !== "draw" || this.pts.n < 2) return undefined;
    const d = this.pts.data, i = (this.pts.n - 1) * PSTRIDE;
    if (this.snap.r) {
      const g = this.snap.g;
      const a0 = Math.atan2(d[1] - g.y, d[0] - g.x);
      let sweep = 0, prev = a0;
      for (let k = 1; k < this.pts.n; k++) {
        const a = Math.atan2(d[k * PSTRIDE + 1] - g.y, d[k * PSTRIDE] - g.x);
        let da = a - prev;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        sweep += da;
        prev = a;
      }
      return `${Math.min(360, Math.round(Math.abs(sweep) * 180 / Math.PI))}°`;
    }
    return `${formatNumber(Math.hypot(d[i] - d[0], d[i + 1] - d[1]) / MM / 10)} cm`;
  }

  private onMove = (e: PointerEvent) => {
    this.perf?.input(e.timeStamp);
    if (e.pointerType === "touch" && this.pendingTouch.has(e.pointerId)) this.pendingTouch.set(e.pointerId, this.local(e));
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, this.local(e));
      if (this.mode === "gesture") return this.updateGesture();
      if (this.mode === "guide" && this.gd?.kind === "two") return this.updateGuideTwo();
    }
    if (e.pointerType === "pen") this.palm.notePen(performance.now());
    if (e.pointerId !== this.activeId) {
      if (this.mode === "idle" && e.pointerType !== "touch" && e.buttons === 0) this.updateHover(this.local(e), e.pointerType);
      if (this.mode === "idle" && e.pointerType !== "touch" && (this.tool.tool === "angle" || this.tool.tool === "laser")) {
        this.rect = null;
        const q = this.local(e);
        if (this.tool.tool === "angle") this.angleHover = this.snapAnglePoint(this.toWorld(q.x, q.y));
        else this.hover = q;
        this.invalidate(false);
      }
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
        this.trackHold(this.local(e));
        if (this.shaped) return;
        // Mit pointerrawupdate kommen die Punkte schon dort an; hier nur die Vorhersage
        if (!RAW || !this.rawSeen) {
          const list = e.getCoalescedEvents?.();
          if (list && list.length) for (let i = 0; i < list.length; i++) this.addPoint(list[i]);
          else this.addPoint(e);
        }
        this.pred.n = 0;
        // Vorhersage nur 1 Punkt und kurz begrenzt: sonst schießt der Live-Strich an Umkehrpunkten (Schreibschrift) über
        const pr = e.getPredictedEvents?.();
        if (pr && pr.length && this.pts.n) {
          this.addPoint(pr[0], this.pred);
          const li = (this.pts.n - 1) * PSTRIDE, d = this.pred.data;
          const vx = d[0] - this.pts.data[li], vy = d[1] - this.pts.data[li + 1];
          const len = Math.hypot(vx, vy), max = PRED_MAX_PX / this.cam.s;
          if (len > max) { d[0] = this.pts.data[li] + (vx * max) / len; d[1] = this.pts.data[li + 1] + (vy * max) / len; }
        }
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
        this.trackHold(this.local(e));
        const w = this.toWorld(...xy(this.local(e)));
        this.lasso.push(w.x, w.y);
        this.invalidate(false);
        return;
      }
      case "transform":
        return this.updateTransform(this.local(e));
      case "guide":
        return this.updateGuide(this.local(e));
      case "tap":
        this.trackHold(this.local(e));
        return;
      case "pan": {
        const q = this.local(e);
        this.trackHold(q);
        this.panRaw.x -= (q.x - this.panLast.x) / this.cam.s;
        this.panRaw.y -= (q.y - this.panLast.y) / this.cam.s;
        this.panLast = q;
        this.cam.x = this.panRaw.x;
        this.cam.y = this.panRaw.y;
        this.softBounds();
        this.cameraChanged(false);
        return;
      }
    }
  };

  /** Eingaben nur sammeln; gezeichnet wird einmal pro Frame (requestAnimationFrame). */
  private onRaw = (e: PointerEvent) => {
    if (this.mode !== "draw" || e.pointerId !== this.activeId || this.shaped) return;
    this.rawSeen = true;
    const list = e.getCoalescedEvents?.();
    if (list && list.length) for (let i = 0; i < list.length; i++) this.addPoint(list[i]);
    else this.addPoint(e);
    this.activeDirty = true;
    this.request();
  };

  /** Debug-Ansicht: Rohpunkte, Druck und Umriss des aktuellen/letzten Strichs. */
  setInkDebug(on: boolean) {
    this.inkDebug = on;
    this.invalidate(false);
  }

  private onUp = (e: PointerEvent) => {
    this.palm.onUp(e.pointerType, e.pointerId, performance.now());
    if (e.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      this.pendingTouch.delete(e.pointerId);
      if (this.mode === "gesture") {
        if (this.touches.size === 0) this.endGesture();
        else this.g.ids = ""; // neu ausrichten
        return;
      }
      if (this.mode === "guide" && this.gd?.kind === "two") {
        // Zurück zu Ein-Finger-Verschieben mit dem verbleibenden Finger
        const rest = [...this.touches.entries()].find(([id]) => id === this.activeId) ?? [...this.touches.entries()][0];
        if (rest) {
          this.activeId = rest[0];
          const w = this.toWorld(rest[1].x, rest[1].y);
          this.gd = { ...this.gd, kind: "move", start: w, gx: this.gd.g.x, gy: this.gd.g.y, ids: undefined };
          return;
        }
      }
    }
    if (e.pointerId !== this.activeId) return;
    switch (this.mode) {
      case "draw": {
        if (!this.shaped) this.addPoint(e);
        const id = this.commitStroke();
        // Doppelklick (Maus) / Doppeltipp (Finger) → Textfeld. Nicht mit dem Stift: Umlaut-Punkte!
        if (this.activeType !== "pen" && this.isTap()) this.registerTap(e, id);
        break;
      }
      case "guide":
        this.gd = null;
        break;
      case "tap": {
        const tt = this.tapTool;
        this.tapTool = null;
        const w = this.toWorld(this.downPos.x, this.downPos.y);
        if (this.maxFromDown >= TAP_SLOP) break;
        if (tt === "fill") this.fillAt(w);
        else if (tt === "angle") this.angleTap(w);
        else this.events.onTextAt?.(w, e.altKey);
        break;
      }
      case "erase":
        this.endErase();
        break;
      case "lasso":
        this.endLasso();
        break;
      case "transform":
        this.handle = null;
        this.snapLines = [];
        this.mode = "idle";
        this.emitSelection();
        break;
      case "pan":
        this.settle();
        if (this.grabTap && this.maxFromDown < TAP_SLOP) {
          // Tippen = Klicken: Textfeld/Tabelle → bearbeiten, Strich/Bild → auswählen, leer → neues Textfeld
          const w = this.toWorld(this.downPos.x, this.downPos.y);
          const o = this.topObjAt(w);
          if (o && o.kind !== "image") {
            const rc = this.rect ?? this.active.getBoundingClientRect();
            this.events.onObjTap?.(o.id, rc.left + this.downPos.x, rc.top + this.downPos.y);
            this.endPointer();
            return;
          }
          if (!this.pickAt(w)) this.events.onTextAt?.(w, e.altKey);
        } else if (this.activeType === "touch" && this.isTap()) {
          const o = this.topObjAt(this.toWorld(this.downPos.x, this.downPos.y));
          if (o && o.kind !== "image") {
            // Finger tippt in ein Textfeld/eine Tabelle → direkt bearbeiten (Schreibmarke an der Tippstelle)
            const rc = this.rect ?? this.active.getBoundingClientRect();
            this.events.onObjTap?.(o.id, rc.left + this.downPos.x, rc.top + this.downPos.y);
            this.endPointer();
            return;
          }
          if (o?.kind === "image") this.hoverObj = o; // Antippen zeigt den Greifbalken
          else this.hoverObj = null;
          this.lockHover = o ? null : this.lockedAt(this.toWorld(this.downPos.x, this.downPos.y));
          this.invalidate(false);
          this.registerTap(e, null);
        }
        this.emitSelection();
        break;
    }
    this.endPointer();
  };

  private onCancel = (e: PointerEvent) => {
    this.palm.onUp(e.pointerType, e.pointerId, performance.now());
    this.touches.delete(e.pointerId);
    this.pendingTouch.delete(e.pointerId);
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
      this.softBounds();
      this.cameraChanged(true);
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.settle(), 140);
    }
  };

  /** Touch auf DOM-Objekten (Textfelder) ebenfalls verwerfen, solange der Stift aktiv ist. */
  isPalmTouch(e: { pointerType: string; pointerId: number; width?: number; height?: number }): boolean {
    if (e.pointerType !== "touch") return false;
    return this.palm.isPalm(e.pointerId) || this.palm.penActive(performance.now()) || (Math.max(e.width ?? 0, e.height ?? 0) >= PALM_CONTACT_PX && this.palm.penActive(performance.now(), PALM_SIZE_WINDOW_MS));
  }

  /** Laufende Ein-/Mehrfinger-Aktion verwerfen (Handballen lag vor dem Stift auf). */
  private abortTouch() {
    if (this.mode === "draw") this.pts.n = 0;
    if (this.mode === "lasso") this.lasso = [];
    if (this.mode === "erase") this.endErase();
    if (this.mode === "pan") this.settle();
    this.palm.demoteTouches();
    this.touches.clear();
    this.pendingTouch.clear();
    this.endPointer();
  }

  private lastUpAt = -Infinity;

  private endPointer() {
    this.lastUpAt = performance.now();
    clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.gd = null;
    this.snap = null;
    this.shaped = false;
    this.ephemeral = null;
    this.tapTool = null;
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
    if (this.mode === "guide") this.gd = null;
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
    this.softBounds();
    if (Math.hypot(mid.x - this.g.mid.x, mid.y - this.g.mid.y) > TAP_SLOP || Math.abs(dist - this.g.dist) > TAP_SLOP)
      this.g.moved = true;
    this.cameraChanged(true);
  }

  private endGesture() {
    this.mode = "idle";
    this.settle();
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
    this.liveOpacity = t.opacity ?? PENS[t.pen].opacity;
    this.livePressure = e.pointerType === "pen" && t.pen !== "ballpoint" && t.pen !== "highlighter";
    this.t0 = e.timeStamp;
    this.pts.n = 0;
    this.pred.n = 0;
    this.smooth.reset();
    this.posFilter.reset();
    this.lastP = 0.5;
    this.rawSeen = false;
    this.shaped = false;
    this.shapeVec = null;
    if (this.ephemeral) this.livePressure = e.pointerType === "pen";
    this.addPoint(e);
    if (e.pointerType !== "mouse") this.armHold();
    else if (!this.snap) this.armHold(); // Maus: nur Formerkennung (Long-Press nicht nötig, Rechtsklick)
    this.activeDirty = true;
    this.request();
  }

  private addPoint(e: PointerEvent, buf = this.pts) {
    const q = this.local(e);
    if (buf === this.pts && !this.snap) {
      // Zittern weg, ohne Schleifen/Ecken nachzuziehen (Bildschirmpixel → zoomunabhängig gleiches Schriftbild)
      this.posFilter.push(q.x, q.y, e.timeStamp, this.fpt);
      q.x = this.fpt.x;
      q.y = this.fpt.y;
    }
    let x = q.x / this.cam.s + this.cam.x, y = q.y / this.cam.s + this.cam.y;
    const sn = this.snap;
    if (sn) {
      const at = sn.edge && this.gridOn() ? this.toGrid({ x, y }) : { x, y };
      const v = sn.edge ? snapToEdge(sn.g, sn.edge, at) : snapToCircle(sn.g, sn.r!, at);
      x = v.x;
      y = v.y;
      if (sn.r && buf === this.pts) sn.g.angle = Math.atan2(y - sn.g.y, x - sn.g.x);
    }
    const raw = e.pointerType === "pen" ? (e.pressure > 0 ? this.curve(e.pressure) : this.lastP) : 0.5;
    this.lastP = raw;
    const tilt = Math.max(Math.abs(e.tiltX || 0), Math.abs(e.tiltY || 0));
    if (buf === this.pts) {
      const p = this.smooth.push(raw);
      if (buf.n > 0) {
        // Fast identische Punkte (unter 0,3 Bildschirmpixel) nicht übernehmen, nur Druck aktualisieren
        const i = (buf.n - 1) * PSTRIDE;
        if (Math.hypot(buf.data[i] - x, buf.data[i + 1] - y) < minDistWorld(this.cam.s)) {
          buf.data[i + 2] = p;
          return;
        }
      }
      buf.push(x, y, p, tilt, e.timeStamp - this.t0);
      return;
    }
    // Vorhersage: nur temporär, mit letztem geglätteten Druck
    const li = Math.max(0, this.pts.n - 1) * PSTRIDE;
    buf.push(x, y, this.pts.n ? this.pts.data[li + 2] : raw, tilt, e.timeStamp - this.t0);
  }

  private lastTap: { t: number; p: Vec; stroke: string | null } | null = null;

  /** Aktueller Zeiger: Finger/Maus mit Zeichenwerkzeug (→ verschieben bzw. Text). */
  private grabTap = false;

  private isTap() {
    return this.maxFromDown < TAP_SLOP && performance.now() - this.downT < TAP_MS;
  }

  /** Zweiter Tipp kurz nach dem ersten an fast derselben Stelle → Textfeld; dabei entstandene Punkte entfernen. */
  private registerTap(e: PointerEvent, stroke: string | null) {
    const now = performance.now(), p = this.downPos, l = this.lastTap;
    if (l && now - l.t < DOUBLE_TAP_MS && Math.hypot(p.x - l.p.x, p.y - l.p.y) < TAP_SLOP * 2) {
      this.lastTap = null;
      const ids = [l.stroke, stroke].filter((x): x is string => !!x);
      const rm = ids.map((id) => this.store.get(id)).filter((s): s is Stroke => !!s);
      if (rm.length) this.store.commit({ add: [], remove: rm });
      this.events.onTextAt?.(this.toWorld(l.p.x, l.p.y), e.altKey);
      return;
    }
    this.lastTap = { t: now, p, stroke };
  }

  private commitStroke(): string | null {
    let id: string | null = null;
    if (this.ephemeral) {
      // Laserpointer / verschwindende Tinte: nie gespeichert
      if (this.ephemeral === "vanish" && this.pts.n > 0) {
        this.fading.push({
          t: performance.now(),
          s: makeStroke({ id: uid(), z: 0, pen: this.livePen === "highlighter" ? "ballpoint" : this.livePen, color: this.liveColor, width: this.liveWidth, opacity: 1, pressure: this.livePressure, points: this.pts.snapshot() }),
        });
      } else if (this.pts.n > 0) this.laserTail = { t: performance.now(), pts: this.pts.snapshot() };
      this.ephemeral = null;
      this.pts.n = 0;
      this.pred.n = 0;
      this.request();
      return null;
    }
    if (this.tool.shapeMode && !this.shaped && !this.snap && this.pts.n > 2) this.applyShape();
    // Linie mit Pfeilspitzen: erkannte Linie/Pfeil oder am Lineal gezogene Gerade → Vektorlinie
    const h0 = this.tool.head0 ?? "none", h1 = this.tool.head1 ?? "none";
    if (!this.shapeVec && this.snap?.edge && this.pts.n > 1 && (h0 !== "none" || h1 !== "none")) {
      const d = this.pts.data, j = (this.pts.n - 1) * PSTRIDE;
      this.shapeVec = { a: { x: d[0], y: d[1] }, b: { x: d[j], y: d[j + 1] }, head0: h0, head1: h1 };
    }
    if (this.shapeVec && this.livePen !== "highlighter") {
      const sv = this.shapeVec;
      this.shapeVec = null;
      const syms = this.store.objects().filter((o): o is ImageObj => o.kind === "image" && o.data.vec?.t === "symbol");
      const tol = 16 / this.cam.s;
      const spec: LineSpec = {
        t: "line", pts: [snapToTerminal(sv.a, syms, tol), snapToTerminal(sv.b, syms, tol)],
        color: this.liveColor, width: Math.max(1, this.liveWidth), head0: sv.head0, head1: sv.head1,
      };
      const o = vecObj(spec, null, this.store.nextZ());
      this.store.commit({ add: [], remove: [], addObj: [o] });
      this.pts.n = 0;
      this.pred.n = 0;
      return o.id;
    }
    this.shapeVec = null;
    if (this.pts.n > 0) {
      if (this.livePressure) clampPressureEdges(this.pts.data, this.pts.n);
      if (this.inkDebug) this.dbg = { pts: this.pts.snapshot(), n: this.pts.n, pen: this.livePen, width: this.liveWidth, pressure: this.livePressure };
      const s = makeStroke({
        id: uid(),
        z: this.store.nextZ(),
        pen: this.livePen,
        color: this.liveColor,
        width: this.liveWidth,
        opacity: this.liveOpacity,
        pressure: this.livePressure,
        points: this.pts.snapshot(),
      });
      this.store.commit({ add: [s], remove: [] });
      id = s.id;
    }
    this.pts.n = 0;
    this.pred.n = 0;
    return id;
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
    if (this.maxFromDown < TAP_SLOP) {
      // Stifttaste kurz gedrückt → Radialmenü; sonst Tipp wählt Bild
      if (this.barrel && performance.now() - this.downT < 450) {
        this.events.onRadial?.(this.downPos);
        return;
      }
      this.pickAt(this.toWorld(this.downPos.x, this.downPos.y));
      return;
    }
    const picked = this.store.all().filter((s) => strokeInLasso(s, poly));
    const objs = this.store.objects().filter((o): o is ImageObj => {
      if (o.kind !== "image" || o.data.locked) return false;
      const c = objCorners(o);
      return c.filter((p) => pointInPolygon(p.x, p.y, poly)).length >= 3 || pointInPolygon(o.x + o.w / 2, o.y + o.h / 2, poly);
    });
    if (picked.length || objs.length) this.select(picked, objs);
  }

  /** Antippen wählt den obersten Strich / die Form oder ein Bild darunter (wie „Auswählen“ in OneNote). */
  private pickAt(w: Vec): boolean {
    const r = 10 / this.cam.s;
    let hit: Stroke | null = null;
    for (const s of this.store.all()) if (!this.hidden.has(s.id) && hitStroke(s, w.x, w.y, r)) hit = s;
    if (hit) { this.select([hit]); return true; }
    const imgs = this.store.objects().filter((o): o is ImageObj => o.kind === "image" && !o.data.locked && hitObj(o, w.x, w.y));
    if (imgs.length) { this.select([], [imgs[imgs.length - 1]]); return true; }
    return false;
  }

  private select(strokes: Stroke[], objs: ImageObj[] = []) {
    this.unhide();
    const bbox = unionAll(strokes, objs);
    this.sel = { strokes, objs, bbox, center: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, tx: 0, ty: 0, theta: 0, s: 1 };
    for (const s of strokes) this.hidden.add(s.id);
    for (const o of objs) this.hidden.add(o.id);
    this.tiles.invalidate(bbox);
    this.invalidate(true);
    this.emitSelection();
  }

  private unhide() {
    if (!this.hidden.size) return;
    for (const id of this.hidden) {
      const s = this.store.get(id) ?? this.store.getObj(id);
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
      this.snapMove(s);
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

  // ---- Elemente verschieben: Hover-Greifbalken, Einrasten, Pfeiltasten ----
  private hoverObj: ImageObj | null = null;
  private hoverText: string | null = null;
  private snapLines: { x?: number; y?: number }[] = [];
  /** Einrasten beim Verschieben aus (z. B. Alt gedrückt) */
  snapOff = false;

  private topObjAt(w: Vec): CanvasObj | null {
    const objs = this.store.objects();
    let best: CanvasObj | null = null;
    for (const o of objs) {
      if (o.kind === "image" && o.data.locked) continue;
      if (hitObj(o, w.x, w.y) && (!best || layerRank(o) > layerRank(best) || (layerRank(o) === layerRank(best) && o.z > best.z))) best = o;
    }
    return best;
  }

  /** Oberstes gesperrtes Bild/PDF unter `w` (für das Entsperren-Symbol). */
  private lockedAt(w: Vec): ImageObj | null {
    let best: ImageObj | null = null;
    for (const o of this.store.objects())
      if (o.kind === "image" && o.data.locked && hitObj(o, w.x, w.y) && (!best || o.z > best.z)) best = o;
    return best;
  }

  /** Ausgewählte Bilder/PDFs sperren: liegen dann fest im Hintergrund und werden nicht mehr ausgewählt. */
  lockSelection() {
    const sel = this.sel;
    if (!sel?.objs.length) return;
    const ids = new Set(sel.objs.map((o) => o.id));
    this.commitSelection();
    const before = this.store.objects().filter((o): o is ImageObj => o.kind === "image" && ids.has(o.id));
    const after = before.map((o) => ({ ...o, data: { ...o.data, locked: true } }));
    this.store.commit({ add: [], remove: [], removeObj: before, addObj: after });
    this.hoverObj = null;
    this.events.onToast?.(after.length === 1 ? "Gesperrt – liegt jetzt im Hintergrund" : `${after.length} Elemente gesperrt`);
  }

  /** Gesperrtes Bild/PDF wieder bedienbar machen und auswählen. */
  unlockObject(id: string) {
    const o = this.store.getObj(id);
    if (o?.kind !== "image" || !o.data.locked) return;
    const after: ImageObj = { ...o, data: { ...o.data, locked: undefined } };
    this.store.commit({ add: [], remove: [], removeObj: [o], addObj: [after] });
    this.lockHover = null;
    this.select([], [after]);
  }

  /** Greifbalken (Bildschirm) über einem Bild/PDF: 120×44 px, mittig über der Oberkante. */
  private gripRect(o: ImageObj) {
    const c = objCorners(o).map((p) => this.toScreen(p.x, p.y));
    const top = Math.min(...c.map((p) => p.y));
    const cx = c.reduce((a, p) => a + p.x, 0) / 4;
    return { x: cx - 60, y: top - 50, w: 120, h: 44 };
  }

  /** Gesperrtes Element unter der Maus/angetippt: kleines Schloss oben rechts zum Entsperren. */
  private lockHover: ImageObj | null = null;

  private lockBadgeRect(o: ImageObj) {
    const c = objCorners(o).map((p) => this.toScreen(p.x, p.y));
    const top = Math.min(...c.map((p) => p.y)), right = Math.max(...c.map((p) => p.x));
    return { x: Math.min(right, this.W) - 52, y: Math.max(top, 0) + 8, w: 44, h: 44 };
  }

  private lockBadgeAt(q: Vec): ImageObj | null {
    const o = this.lockHover;
    if (!o || this.sel) return null;
    const r = this.lockBadgeRect(o);
    return q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h ? o : null;
  }

  private drawLockBadge(ctx: CanvasRenderingContext2D) {
    const o = this.lockHover;
    if (!o || this.sel || this.mode !== "idle") return;
    const r = this.lockBadgeRect(o);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.pal.dark ? "#27272a" : "#ffffff";
    ctx.strokeStyle = this.pal.dark ? "#52525b" : "#d4d4d8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 10);
    ctx.fill();
    ctx.stroke();
    // Schloss
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.strokeStyle = ctx.fillStyle = this.pal.dark ? "#d4d4d8" : "#52525b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 3, 5, Math.PI, 0);
    ctx.stroke();
    ctx.fillRect(cx - 7, cy - 3, 14, 11);
  }

  private gripAt(q: Vec): ImageObj | null {
    const o = this.hoverObj;
    if (!o || this.sel) return null;
    const r = this.gripRect(o);
    return q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h + 6 ? o : null;
  }

  private updateHover(q: Vec, type: string) {
    if (this.gripAt(q) || this.lockBadgeAt(q)) return; // auf dem Balken bleiben
    const o = this.topObjAt(this.toWorld(q.x, q.y));
    const img = o?.kind === "image" && !this.hidden.has(o.id) ? o : null;
    if (img !== this.hoverObj) {
      this.hoverObj = img;
      this.invalidate(false);
    }
    // Mit dem Stift nur beim Lasso (sonst würde man beim Schreiben aus Versehen entsperren)
    const lk = !o && (type !== "pen" || this.tool.tool === "lasso") ? this.lockedAt(this.toWorld(q.x, q.y)) : null;
    if (lk !== this.lockHover) {
      this.lockHover = lk;
      this.invalidate(false);
    }
    // Text/Tabellen nur mit der Maus (Stift schreibt sonst ins Textfeld statt aufs Blatt)
    const txt = type === "mouse" && o && o.kind !== "image" ? o.id : null;
    if (txt !== this.hoverText) {
      this.hoverText = txt;
      this.events.onHoverObj?.(txt);
    }
  }

  private drawGrip(ctx: CanvasRenderingContext2D) {
    const o = this.hoverObj;
    if (!o || this.sel || this.mode !== "idle") return;
    const r = this.gripRect(o);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.pal.dark ? "#27272a" : "#ffffff";
    ctx.strokeStyle = this.pal.dark ? "#52525b" : "#d4d4d8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y + 8, r.w, r.h - 16, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.pal.dark ? "#a1a1aa" : "#71717a";
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 2; j++) {
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2 - 15 + i * 6, r.y + r.h / 2 - 3 + j * 6, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
  }

  /** Verschieben: Kanten/Mitten an anderen Elementen und am Raster einrasten (Hilfslinien). */
  private snapMove(s: Selection) {
    this.snapLines = [];
    if (this.snapOff) return;
    const tol = 6 / this.cam.s;
    const hw = (s.bbox.w * s.s) / 2, hh = (s.bbox.h * s.s) / 2;
    const cx = s.center.x + s.tx, cy = s.center.y + s.ty;
    const xs = [cx - hw, cx, cx + hw], ys = [cy - hh, cy, cy + hh];
    const tx: number[] = [], ty: number[] = [];
    const sel = new Set(s.objs.map((o) => o.id));
    for (const o of this.store.objects()) {
      if (sel.has(o.id)) continue;
      const b = o.bbox;
      tx.push(b.x, b.x + b.w / 2, b.x + b.w);
      ty.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    if (this.setup.mode === "a4") {
      const { w } = a4Size(this.setup.orientation);
      tx.push(0, w / 2, w);
    }
    const best = (cand: number[], targets: number[]) => {
      let d = Infinity, at = 0;
      for (const c of cand) for (const t of targets) if (Math.abs(t - c) < Math.abs(d)) { d = t - c; at = t; }
      return Math.abs(d) <= tol ? { d, at } : null;
    };
    let bx = best(xs, tx), by = best(ys, ty);
    // Raster (kariert/punktiert/liniert), wenn kein Element näher ist
    if (this.setup.background !== "blank") {
      const step = Math.max(1, this.setup.bgSpacingMm) * MM;
      const g = (v: number) => Math.round(v / step) * step - v;
      if (!bx && this.setup.background !== "lines") { const d = g(xs[0]); if (Math.abs(d) <= tol) bx = { d, at: NaN }; }
      if (!by) { const d = g(ys[0]); if (Math.abs(d) <= tol) by = { d, at: NaN }; }
    }
    if (bx) { s.tx += bx.d; if (!Number.isNaN(bx.at)) this.snapLines.push({ x: bx.at }); }
    if (by) { s.ty += by.d; if (!Number.isNaN(by.at)) this.snapLines.push({ y: by.at }); }
  }

  private drawSnapLines(ctx: CanvasRenderingContext2D) {
    if (this.mode !== "transform" || !this.snapLines.length) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = "#ec4899";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const l of this.snapLines) {
      ctx.beginPath();
      if (l.x !== undefined) { const p = this.toScreen(l.x, 0); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, this.H); }
      else if (l.y !== undefined) { const p = this.toScreen(0, l.y); ctx.moveTo(0, p.y); ctx.lineTo(this.W, p.y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Auswahl per Pfeiltaste verschieben (Welteinheiten). Liefert false, wenn nichts ausgewählt ist. */
  nudgeSelection(dx: number, dy: number): boolean {
    const s = this.sel;
    if (!s || this.mode !== "idle") return false;
    s.tx += dx;
    s.ty += dy;
    this.invalidate(false);
    clearTimeout(this.nudgeTimer);
    this.events.onSelection?.(null);
    this.nudgeTimer = window.setTimeout(() => this.emitSelection(), 250);
    return true;
  }
  private nudgeTimer = 0;

  /** Einrasten aktiv (nur auf karierten/punktierten/linierten Blättern)? */
  private gridOn(): boolean {
    return !!this.tool.gridSnap && this.setup.background !== "blank";
  }
  /** Punkt auf den nächsten Rasterpunkt (liniert: nur senkrecht auf die Linie). */
  private toGrid(v: Vec): Vec {
    const st = this.gridStep();
    const r = (n: number) => Math.round(n / st) * st;
    return this.setup.background === "lines" ? { x: v.x, y: r(v.y) } : { x: r(v.x), y: r(v.y) };
  }

  /** Rasterschritt (für Umschalt+Pfeil). */
  gridStep(): number {
    return Math.max(1, this.setup.bgSpacingMm) * MM;
  }

  private selHeads(): { head0: Head; head1: Head } | null {
    const sel = this.sel!;
    const line = sel.objs.find((o) => o.data.vec?.t === "line")?.data.vec as LineSpec | undefined;
    if (line) return { head0: line.head0, head1: line.head1 };
    if (sel.strokes.length && sel.strokes.length <= 8 && !sel.objs.length) {
      const st = sel.strokes[0];
      const pts: Vec[] = [];
      for (let i = 0; i < st.points.length; i += PSTRIDE) pts.push({ x: st.points[i], y: st.points[i + 1] });
      const k = recognize(pts)?.kind;
      if (k === "line") return { head0: "none", head1: "none" };
    }
    return null;
  }

  private emitSelection() {
    const cb = this.events.onSelection;
    if (!cb) return;
    if (!this.sel || this.mode === "transform") return cb(null);
    const c = this.selCorners();
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    const colors = new Set(this.sel.strokes.map((s) => s.color));
    const all = [...this.sel.strokes, ...this.sel.objs];
    const anchor = all.reduce((a, b) => (b.bbox.y + b.bbox.x * 0.25 < a.bbox.y + a.bbox.x * 0.25 ? b : a), all[0]);
    cb({
      count: all.length,
      ids: [anchor.id, ...all.filter((e) => e !== anchor).map((e) => e.id)],
      rect: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
      color: colors.size === 1 ? [...colors][0] : null,
      strokes: this.sel.strokes.length,
      images: this.sel.objs.length,
      heads: this.selHeads(),
      vec: this.sel.objs.length === 1 && !this.sel.strokes.length && this.sel.objs[0].data.vec && this.sel.objs[0].data.vec.t !== "fill"
        ? this.sel.objs[0].data.vec : null,
      mol: this.sel.objs.length === 1 && !this.sel.strokes.length ? this.sel.objs[0].data.mol ?? null : null,
    });
  }


  // ================= Formen, Füllen, Winkel, Laser =================

  /** Bilder in Zeichenreihenfolge: feste PDF-Seiten, dann Füllungen, dann übrige (je nach z). */
  private layeredImages(): ImageObj[] {
    const imgs = this.store.objects().filter((o): o is ImageObj => o.kind === "image");
    const rank = (o: ImageObj) => (o.data.locked ? 0 : o.data.vec?.t === "fill" ? 1 : 2);
    return imgs.sort((a, b) => rank(a) - rank(b) || a.z - b.z);
  }

  /** Füllwerkzeug: geschlossenen Bereich um `w` füllen (Lücken bis 2 mm). */
  private fillAt(w: Vec) {
    const gap = 2 * MM;
    const strokes = this.store.all().filter((s) => s.pen !== "highlighter");
    const walls = this.store.objects().filter((o): o is ImageObj => o.kind === "image" && !!o.data.vec && o.data.vec.t !== "fill");
    const draw: DrawWalls = (ctx, grow) => {
      ctx.fillStyle = ctx.strokeStyle = "#000";
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.lineWidth = grow;
      for (const s of strokes) {
        const p = strokePath(s);
        ctx.fill(p);
        ctx.stroke(p);
      }
      const d = grow / 2;
      for (const o of walls) {
        const img = this.image(o.data.src);
        if (!img?.complete || !img.naturalWidth) continue;
        for (const [dx, dy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
          ctx.save();
          ctx.translate(o.x + o.w / 2 + dx, o.y + o.h / 2 + dy);
          if (o.angle) ctx.rotate(o.angle);
          ctx.drawImage(img, -o.w / 2, -o.h / 2, o.w, o.h);
          ctx.restore();
        }
      }
    };
    const reg = findRegion(w, draw, gap, this.contentBounds());
    const spec: FillSpec = { t: "fill", color: this.tool.color, opacity: this.tool.fillOpacity ?? 0.35, hatch: this.tool.fillHatch ?? null };
    const painted = reg && paintRegion(reg, spec);
    if (!painted) {
      this.events.onToast?.("Kein geschlossener Bereich gefunden – Lücken bis 2 mm werden überbrückt");
      return;
    }
    const r = painted.rect;
    const o = makeObj<ImageObj>({ id: uid(), kind: "image", z: this.store.nextZ(), x: r.x, y: r.y, w: r.w, h: r.h, angle: 0, data: { src: painted.src, vec: spec } });
    this.store.commit({ add: [], remove: [], addObj: [o] });
  }

  /** Punkt an Lineal/Geodreieck-Kante einrasten (Winkel messen mit dem Geodreieck). */
  private snapAnglePoint(w: Vec): Vec {
    const tol = 14 / this.cam.s;
    for (const k of ["setsquare", "ruler"] as const) {
      const g = this.guides.get(k);
      const e = g && nearestEdge(g, w, tol);
      if (g && e) return snapToEdge(g, e, w);
    }
    return w;
  }

  /** Gerade unter dem Punkt: Vektorlinie oder gerader Strich. */
  private lineAt(w: Vec): { a: Vec; b: Vec } | null {
    const tol = 10 / this.cam.s;
    const near = (a: Vec, b: Vec) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / l2));
      return Math.hypot(w.x - a.x - t * dx, w.y - a.y - t * dy) <= tol;
    };
    for (const o of [...this.store.objects()].reverse()) {
      if (o.kind !== "image" || o.data.vec?.t !== "line") continue;
      const p = vecLinePts(o);
      for (let i = 1; i < p.length; i++) if (near(p[i - 1], p[i])) return { a: p[i - 1], b: p[i] };
    }
    for (const s of this.store.inRect({ x: w.x - tol, y: w.y - tol, w: 2 * tol, h: 2 * tol })) {
      const pts: Vec[] = [];
      for (let i = 0; i < s.points.length; i += PSTRIDE) pts.push({ x: s.points[i], y: s.points[i + 1] });
      const sh = recognize(pts);
      if (sh?.kind === "line" && near(sh.points[0], sh.points[1])) return { a: sh.points[0], b: sh.points[1] };
    }
    return null;
  }

  /** Winkel messen: drei Punkte (Schenkel, Scheitel, Schenkel) oder zwei Linien antippen. */
  private angleTap(w0: Vec) {
    if (this.angleDone) this.resetAngle();
    const w = this.snapAnglePoint(w0);
    if (!this.anglePts.length) {
      const l = this.lineAt(w0);
      if (l || this.angleLines.length) {
        if (!l) return this.events.onToast?.("Zweite Linie antippen");
        this.angleLines.push({ ...l, tap: w0 });
        if (this.angleLines.length === 2) {
          const [l1, l2] = this.angleLines;
          const v = intersectLines(l1.a, l1.b, l2.a, l2.b);
          if (!v) {
            this.angleLines = [];
            return this.events.onToast?.("Die Linien sind parallel");
          }
          const side = (l: { a: Vec; b: Vec; tap: Vec }) => {
            const far = Math.hypot(l.a.x - v.x, l.a.y - v.y) > Math.hypot(l.b.x - v.x, l.b.y - v.y) ? l.a : l.b;
            // Schenkel zur angetippten Seite
            const dot = (l.tap.x - v.x) * (far.x - v.x) + (l.tap.y - v.y) * (far.y - v.y);
            return dot >= 0 ? far : { x: 2 * v.x - far.x, y: 2 * v.y - far.y };
          };
          this.finishAngle(side(l1), v, side(l2));
        } else this.events.onToast?.("Linie gewählt – jetzt die zweite Linie antippen");
        this.invalidate(false);
        return;
      }
    }
    this.anglePts.push(w);
    if (this.anglePts.length === 3) {
      const [a, b, c] = this.anglePts;
      this.finishAngle(a, b, c);
    }
    this.invalidate(false);
  }

  private finishAngle(a: Vec, b: Vec, c: Vec) {
    this.angleDone = { a, b, c };
    this.anglePts = [];
    this.angleLines = [];
    this.events.onAngle?.({ deg: angleDeg(a, b, c), at: this.toScreen(b.x, b.y) });
  }

  resetAngle() {
    this.anglePts = [];
    this.angleLines = [];
    this.angleDone = null;
    this.events.onAngle?.(null);
    this.invalidate(false);
  }

  /** Gemessenen Winkel als Beschriftung (Bogen + Gradzahl) einfügen. */
  insertAngleLabel() {
    const d = this.angleDone;
    if (!d) return;
    const spec: AngleSpec = { t: "angle", a: d.a, b: d.b, c: d.c, color: this.tool.color };
    this.store.commit({ add: [], remove: [], addObj: [vecObj(spec, null, this.store.nextZ())] });
    this.resetAngle();
  }

  private renderAngleTool(ctx: CanvasRenderingContext2D) {
    const pts = this.angleDone ? [this.angleDone.a, this.angleDone.b, this.angleDone.c]
      : this.angleHover && this.anglePts.length ? [...this.anglePts, this.angleHover] : this.anglePts;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#f97316";
    ctx.fillStyle = "#f97316";
    ctx.lineWidth = 2;
    for (const l of this.angleLines) {
      const a = this.toScreen(l.a.x, l.a.y), b = this.toScreen(l.b.x, l.b.y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const sp = pts.map((p) => this.toScreen(p.x, p.y));
    if (sp.length >= 2) {
      ctx.beginPath();
      sp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    for (const p of sp) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
    if (pts.length === 3) {
      const [a, b, c] = sp;
      const ua = Math.atan2(a.y - b.y, a.x - b.x), uc = Math.atan2(c.y - b.y, c.x - b.x);
      let da = uc - ua;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 34, ua, ua + da, da < 0);
      ctx.stroke();
      const mid = ua + da / 2, label = fmtDeg(angleDeg(pts[0], pts[1], pts[2]));
      ctx.font = "600 15px system-ui, sans-serif";
      const tx = b.x + Math.cos(mid) * 58, ty = b.y + Math.sin(mid) * 58;
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(249,115,22,0.95)";
      ctx.beginPath(); ctx.roundRect(tx - tw / 2, ty - 12, tw, 24, 12); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, tx, ty);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
  }

  /** Laserpunkt mit Spur und verblassende Tinte; true = weitere Frames nötig. */
  private renderEphemeral(ctx: CanvasRenderingContext2D): boolean {
    const now = performance.now();
    let more = false;
    const vanish = this.tool.vanishMs ?? 2000, FADE = 450;
    if (this.fading.length) {
      this.fading = this.fading.filter((f) => now - f.t < vanish + FADE);
      this.worldTransform(ctx);
      for (const f of this.fading) {
        const age = now - f.t;
        ctx.globalAlpha = age < vanish ? 1 : 1 - (age - vanish) / FADE;
        drawStroke(ctx, f.s, this.pal.dark, strokePath(f.s));
      }
      ctx.globalAlpha = 1;
      if (this.fading.length) more = true;
    }
    const laserLive = this.mode === "draw" && this.ephemeral === "laser";
    const tail = laserLive ? { t: now, pts: this.pts.data.subarray(0, this.pts.n * PSTRIDE) } : this.laserTail;
    if (tail && tail.pts.length) {
      const age = now - tail.t;
      if (age > 350) this.laserTail = null;
      else {
        const dpr = this.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = ctx.lineJoin = "round";
        const d = tail.pts, k = d.length / PSTRIDE, tEnd = d[(k - 1) * PSTRIDE + 4];
        const fade = laserLive ? 1 : 1 - age / 350;
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 12;
        for (let i = 1; i < k; i++) {
          const dt = tEnd - d[i * PSTRIDE + 4] + (laserLive ? 0 : age);
          if (dt > 300) continue; // kurze Spur
          const a = this.toScreen(d[(i - 1) * PSTRIDE], d[(i - 1) * PSTRIDE + 1]), b = this.toScreen(d[i * PSTRIDE], d[i * PSTRIDE + 1]);
          ctx.strokeStyle = `rgba(239,68,68,${(1 - dt / 300) * fade})`;
          ctx.lineWidth = 2 + 4 * (1 - dt / 300);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        const j = (k - 1) * PSTRIDE, p = this.toScreen(d[j], d[j + 1]);
        this.laserDot(ctx, p, fade);
        ctx.shadowBlur = 0;
        more = true;
      }
    } else if (this.tool.tool === "laser" && this.hover && this.mode === "idle") {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.laserDot(ctx, this.hover, 0.7);
    }
    return more;
  }

  private laserDot(ctx: CanvasRenderingContext2D, p: Vec, alpha: number) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.25, `rgba(248,113,113,${alpha})`);
    g.addColorStop(1, "rgba(239,68,68,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
  }

  /** Pfeilspitzen der Auswahl ändern (Vektorlinien; gerade Striche werden zu Vektorlinien). */
  setSelectionHeads(h: { head0?: Head; head1?: Head }) {
    const sel = this.sel;
    if (!sel) return;
    this.commitSelection();
    const objs: ImageObj[] = [], removeO: ImageObj[] = [], removeS: Stroke[] = [];
    for (const o of sel.objs.map((x) => this.store.getObj(x.id) as ImageObj | undefined)) {
      if (o?.data.vec?.t !== "line") continue;
      removeO.push(o);
      objs.push(updateVecObj(o, { ...o.data.vec, ...h }));
    }
    for (const st of sel.strokes.map((x) => this.store.get(x.id)).filter((x): x is Stroke => !!x)) {
      const pts: Vec[] = [];
      for (let i = 0; i < st.points.length; i += PSTRIDE) pts.push({ x: st.points[i], y: st.points[i + 1] });
      const sh = recognize(pts);
      if (sh?.kind !== "line" && sh?.kind !== "arrow") continue;
      removeS.push(st);
      objs.push(vecObj({ t: "line", pts: [sh.points[0], sh.points[1]], color: st.color, width: st.width, head0: h.head0 ?? "none", head1: h.head1 ?? "none" }, null, st.z));
    }
    if (!objs.length) return;
    this.store.commit({ add: [], remove: removeS, removeObj: removeO, addObj: objs });
    this.select([], objs);
  }

  /** Einzelnes ausgewähltes Vektor-Element neu parametrieren (Achsen, Linien …). */
  updateSelectedVec(spec: VecSpec) {
    const o = this.sel?.objs.length === 1 && !this.sel.strokes.length ? this.sel.objs[0] : null;
    if (!o?.data.vec) return;
    this.commitSelection();
    const cur = this.store.getObj(o.id) as ImageObj;
    this.replaceSelectionWith(cur, updateVecObj(cur, spec));
  }

  /** Strukturformel unter einem Bildschirmpunkt (relativ zum Host), z. B. für Doppeltipp. */
  molAt(p: Vec): ImageObj | null {
    const o = this.topObjAt(this.toWorld(p.x, p.y));
    return o?.kind === "image" && o.data.mol ? o : null;
  }

  /** Beliebiges Objekt durch ein anderes ersetzen (ein Undo-Schritt), z. B. Textfeld → Tabelle. */
  replaceObject(before: CanvasObj, after: CanvasObj) {
    this.commitSelection();
    const cur = this.store.getObj(before.id) ?? before;
    this.store.commit({ add: [], remove: [], removeObj: [cur], addObj: [after] });
  }

  /** Bild-Element ersetzen (ein Undo-Schritt) und auswählen. */
  replaceImage(before: ImageObj, after: ImageObj) {
    this.commitSelection();
    const cur = (this.store.getObj(before.id) as ImageObj | undefined) ?? before;
    this.replaceSelectionWith(cur, after);
  }

  private replaceSelectionWith(before: ImageObj, after: ImageObj) {
    this.store.commit({ add: [], remove: [], removeObj: [before], addObj: [after] });
    this.select([], [after]);
  }

  /** Auswahl mit eingerechneter Transformation (für „Als Vorlage speichern“). */
  selectionElements(): { strokes: Stroke[]; objs: ImageObj[]; bbox: BBox } | null {
    const sel = this.sel;
    if (!sel) return null;
    const m = this.selMatrix();
    const strokes = sel.strokes.map((x) => transformStroke(x, m));
    const objs = sel.objs.map((o) => transformObj(o, m));
    return { strokes, objs, bbox: unionAll(strokes, objs) };
  }

  /** Vorlage einfügen: Elemente (relativ zu 0,0) mit neuen IDs bei `at` (oben links), ausgewählt. */
  insertElements(strokes: Stroke[], objs: ImageObj[], at: Vec) {
    this.commitSelection();
    const off: Mat = [1, 0, 0, 1, at.x, at.y];
    const s2 = strokes.map((x) => ({ ...transformStroke(x, off, false), z: this.store.nextZ() }));
    const o2 = objs.map((o) => ({ ...transformObj(o, off, uid()), z: this.store.nextZ() }));
    this.store.commit({ add: s2, remove: [], addObj: o2 });
    this.select(s2, o2);
  }

  /** Fertige Striche hinzufügen (Zoom-Schreibfeld), ein Undo-Schritt je Aufruf. */
  addStrokes(strokes: Stroke[]) {
    if (!strokes.length) return;
    this.commitSelection();
    this.store.commit({ add: strokes.map((s) => ({ ...s, z: this.store.nextZ() })), remove: [] });
  }

  /** Striche in einem Weltrechteck (für Vorschauen). */
  strokesIn(r: BBox): Stroke[] {
    return this.store.inRect(r).filter((s) => intersects(s.bbox, r));
  }

  /** Aktuelle Werkzeugeinstellungen (Farbe, Breite, Stift) – z. B. für das Zoom-Schreibfeld. */
  get toolState(): ToolState {
    return this.tool;
  }

  /** Kamera (Welt → Bildschirm: (w - x) * s). */
  get camera() {
    return { ...this.cam };
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

  private perf: PerfMeter | null = null;
  private tileBuf: Stroke[] = [];
  private pdf = new PdfRaster(getAsset);
  private pdfReady = new Set<string>();

  private redrawPdfTiles() {
    const ws = this.tiles.worldSize;
    for (const o of this.store.objects()) {
      if (o.kind !== "image" || !o.data.pdf || !this.pdfReady.has(o.data.pdf.asset + "|" + o.data.pdf.page)) continue;
      const b = o.bbox;
      for (let ty = Math.floor(b.y / ws); ty <= Math.floor((b.y + b.h) / ws); ty++)
        for (let tx = Math.floor(b.x / ws); tx <= Math.floor((b.x + b.w) / ws); tx++) {
          const ctx = this.tiles.existing(tx, ty);
          if (ctx) this.drawTileContent(ctx, this.tiles.tileRect(tx, ty));
        }
    }
    this.pdfReady.clear();
  }

  /** Leistungsmessung ein/aus. `cb` läuft alle 500 ms – nur DOM schreiben, kein React-State. */
  setProfiling(cb: ((s: PerfSample) => void) | null) {
    this.perf = cb ? new PerfMeter(cb, () => ({ strokes: this.store.size, objects: this.store.objects().length })) : null;
    // Beim Profiling läuft die Schleife durchgehend (siehe frame), damit FPS sichtbar sind.
    this.request();
  }

  private frame = (now: number) => {
    this.raf = 0;
    const perf = this.perf;
    const t0 = perf ? performance.now() : 0;
    let tb = 0;
    if (this.baseDirty) {
      this.baseDirty = false;
      if (this.pdfReady.size) this.redrawPdfTiles();
      this.renderBase();
      if (perf) tb = performance.now() - t0;
    }
    const drewInput = this.activeDirty && this.mode === "draw";
    if (this.activeDirty) {
      this.activeDirty = false;
      this.renderActive();
      if (this.activeDirty) this.request(); // Laser/verblassende Tinte animieren
    }
    if (perf) {
      perf.frame(now, performance.now() - t0, tb, drewInput);
      if (!this.raf) this.raf = requestAnimationFrame(this.frame);
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
    const t0 = performance.now();
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
        // Zeitbudget statt fester Anzahl: bei vollen Blättern lieber über mehrere Frames
        // nachzeichnen, als einen Frame lang zu blockieren (Stift-Latenz!).
        if (!c && budget > 0 && (budget === 6 || performance.now() - t0 < (unlimited ? FULL_BUDGET_MS : TILE_BUDGET_MS))) {
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
    this.drawTileContent(ctx, this.tiles.tileRect(tx, ty));
    this.perf?.tile();
    return this.tiles.peek(tx, ty);
  }

  private drawTileContent(ctx: CanvasRenderingContext2D, r: BBox) {
    drawBackground(ctx, r, this.tiles.scale, this.setup, this.pal, this.pageCount);
    for (const o of this.layeredImages())
      if (!this.hidden.has(o.id) && intersects(o.bbox, r)) {
        drawImageObj(ctx, o, this.image(o.data.src), this.pal.dark);
        const ref = o.data.pdf;
        if (ref) {
          ctx.save();
          ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
          if (o.angle) ctx.rotate(o.angle);
          this.pdf.draw(ctx, o, ref, this.tiles.scale, r);
          ctx.restore();
        }
      }
    for (const s of this.store.inRect(r, this.tileBuf)) {
      if (!this.hidden.has(s.id) && intersects(s.bbox, r)) drawStroke(ctx, s, this.pal.dark);
    }
  }

  /** Dekodiertes Bild (gecacht); nach dem Laden werden betroffene Tiles neu gezeichnet. */
  private image(src: string): HTMLImageElement {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.decoding = "async";
      img.onload = () => {
        for (const o of this.store.objects()) if (o.kind === "image" && o.data.src === src) this.tiles.invalidate(o.bbox);
        this.invalidate(true);
      };
      img.src = src;
      this.images.set(src, img);
    }
    return img;
  }

  private worldTransform(ctx: CanvasRenderingContext2D) {
    const k = this.cam.s * this.dpr;
    ctx.setTransform(k, 0, 0, k, -this.cam.x * k, -this.cam.y * k);
  }

  private drawInkDebug(ctx: CanvasRenderingContext2D) {
    const live = this.mode === "draw" && this.pts.n > 0;
    const d = live ? { pts: this.pts.data, n: this.pts.n, pen: this.livePen, width: this.liveWidth, pressure: this.livePressure } : this.dbg;
    if (!d) return;
    this.worldTransform(ctx);
    const k = this.cam.s * this.dpr;
    const outline = buildOutline(d.pen, d.width, d.pressure, toFreehand(d.pts, d.n, d.pen === "ballpoint"), !live);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = "#ef4444";
    ctx.beginPath();
    outline.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    for (let i = 0; i < d.n; i++) {
      const j = i * PSTRIDE, p = d.pts[j + 2];
      ctx.fillStyle = `hsl(${220 - p * 220} 90% 50%)`; // blau = wenig, rot = viel Druck
      ctx.beginPath();
      ctx.arc(d.pts[j], d.pts[j + 1], (1.5 + p * 2.5) / k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillStyle = this.pal.dark ? "#fff" : "#000";
    ctx.fillText(`Punkte ${d.n} · Umriss ${outline.length} · Breite ${d.width} · Zoom ${Math.round(this.cam.s * 100)} %`, 12, this.H - 12);
  }

  private renderActive() {
    const ctx = this.activeCtx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.active.width, this.active.height);
    const dark = this.pal.dark;

    if (this.mode === "draw" && this.pts.n > 0 && this.ephemeral !== "laser") {
      this.worldTransform(ctx);
      const constant = this.livePen === "ballpoint";
      const pts = toFreehand(this.pts.data, this.pts.n, constant);
      if (this.pred.n) for (const p of toFreehand(this.pred.data, this.pred.n, constant)) pts.push(p);
      this.pred.n = 0; // Vorhersage nur für diesen Frame, nie in den Strich übernehmen
      const path = buildPath(this.livePen, this.liveWidth, this.livePressure, pts, false,
        this.pts.n < 3 ? { data: this.pts.data, n: this.pts.n } : undefined);
      drawStroke(ctx, { pen: this.livePen, color: this.liveColor, opacity: this.liveOpacity } as Stroke, dark, path);
    }

    if (this.renderEphemeral(ctx)) this.activeDirty = true;
    if (this.tool.tool === "angle" || this.angleDone) this.renderAngleTool(ctx);

    if (this.sel) {
      this.worldTransform(ctx);
      const m = this.selMatrix();
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      for (const o of this.sel.objs) drawImageObj(ctx, o, this.image(o.data.src), dark);
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

    if (this.guides.size) {
      this.worldTransform(ctx);
      const k = this.cam.s * dpr;
      const label = this.snapLabel();
      for (const k2 of GUIDE_KINDS) {
        const g = this.guides.get(k2);
        if (!g) continue;
        const own = this.snap?.g === g;
        drawGuide(ctx, g, { k, dark, edge: own ? this.snap?.edge?.edge : undefined, label: own ? label : undefined });
      }
    }

    this.drawGrip(ctx);
    this.drawLockBadge(ctx);
    this.drawSnapLines(ctx);
    if (this.inkDebug) this.drawInkDebug(ctx);

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

const RAW = typeof window !== "undefined" && "onpointerrawupdate" in window;

const xy = (v: Vec): [number, number] => [v.x, v.y];

function unionAll(strokes: Stroke[], objs: CanvasObj[]): BBox {
  const parts: BBox[] = [];
  if (strokes.length) parts.push(unionBBox(strokes));
  for (const o of objs) parts.push(o.bbox);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of parts) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Bild (gedreht) in Weltkoordinaten zeichnen. */
export function drawImageObj(ctx: CanvasRenderingContext2D, o: ImageObj, img: HTMLImageElement | undefined, dark = false) {
  ctx.save();
  // Vektor-Elemente folgen der Tinte: im Dunkelmodus Helligkeit umkehren, Farbton behalten
  if (dark && (o.data.vec || o.data.mol)) ctx.filter = "invert(1) hue-rotate(180deg)";
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
  if (o.angle) ctx.rotate(o.angle);
  if (img && img.complete && img.naturalWidth) ctx.drawImage(img, -o.w / 2, -o.h / 2, o.w, o.h);
  else {
    ctx.fillStyle = "rgba(127,127,127,0.15)";
    ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
  }
  ctx.restore();
}

function prevent(e: Event) {
  e.preventDefault();
}

/** Schnittpunkt zweier Geraden (durch a1,a2 und b1,b2) oder null bei Parallelen. */
export function intersectLines(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

/** Ebenen: Textfelder/Tabellen liegen immer über Bildern, PDFs und Formen. */
function layerRank(o: CanvasObj): number {
  return o.kind === "image" ? 0 : 1;
}
