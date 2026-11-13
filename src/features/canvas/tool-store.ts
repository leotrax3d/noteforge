import { create } from "zustand";
import type { PenKind } from "@/canvas/core/model";
import { PENS } from "@/canvas/core/pens";
import type { EraserMode, Tool, ToolState } from "@/canvas/core/engine";
import type { GuideKind } from "@/canvas/tools/guides";
import type { Head } from "@/canvas/vector/vec";
import { MM } from "@/canvas/core/layout";

export interface Preset {
  id: string;
  pen: PenKind;
  color: string;
  width: number;
  /** Deckkraft 0..1; fehlt = Standard des Stifts */
  opacity?: number;
}

/** Platz in der Fach-Kopfzeile, in den sich die Werkzeugleiste andocken lässt. */
export const TOOLBAR_SLOT = "nf-toolbar-slot";
/** Platz rechts in der Kopfzeile für die Blatt-Aktionen (Versionen, Wiedergabe, Menü). */
export const PAGE_ACTIONS_SLOT = "nf-page-actions-slot";
/** „header“ = in der Kopfzeile neben dem Fachnamen (kein Platzverbrauch im Blatt). */
export type Dock = "top" | "bottom" | "left" | "right" | "float" | "header";
export type BarOrient = "horizontal" | "vertical";
export type BarSize = "s" | "m" | "l";

/** Elemente der Stiftleiste (Reihenfolge = Anzeige). */
export const TOOL_ITEMS = [
  "fountain", "ballpoint", "pencil", "highlighter", "eraser", "lasso", "pan", "text", "guides", "insert",
  "presets", "undo", "redo", "zoom", "page", "calc", "plot", "image",
  "shapes", "heads", "fill", "angle", "zoomwrite", "laser", "vanish", "molecule", "fit", "fitpage",
] as const;
export type ToolItem = (typeof TOOL_ITEMS)[number];
export const DEFAULT_ITEMS: ToolItem[] = [
  "fountain", "ballpoint", "pencil", "highlighter", "eraser", "lasso", "pan", "text", "guides", "insert", "molecule",
  "shapes", "heads", "fill", "angle", "zoomwrite", "laser",
  "presets", "undo", "redo", "zoom", "fit", "fitpage", "page",
];

/** Werkzeuge, zu denen der Stift aus „Greifen“ zurückspringt. */
export const INK_TOOLS: Tool[] = ["pen", "eraser", "vanish", "laser", "lasso", "fill", "angle"];

export const PALETTE = [
  "#111827", "#1e3a8a", "#2563eb", "#0891b2", "#16a34a", "#65a30d",
  "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#9333ea", "#6b7280",
];
export const HIGHLIGHTS = ["#fde047", "#86efac", "#67e8f9", "#f9a8d4", "#fdba74", "#c4b5fd"];

const DEFAULT_PRESETS: Preset[] = [
  { id: "p1", pen: "fountain", color: "#1e3a8a", width: 2.5 },
  { id: "p2", pen: "ballpoint", color: "#111827", width: 2 },
  { id: "p3", pen: "ballpoint", color: "#dc2626", width: 2 },
  { id: "p4", pen: "pencil", color: "#374151", width: 1.5 },
  { id: "p5", pen: "highlighter", color: "#fde047", width: 18 },
  { id: "p6", pen: "highlighter", color: "#86efac", width: 18 },
];

interface ToolsStore extends ToolState {
  /** Zuletzt benutzte Farbe/Breite je Stift */
  perPen: Record<PenKind, { color: string; width: number }>;
  presets: Preset[];
  customColors: string[];
  dock: Dock;
  /** Schwebende Position (Anteil der Fläche, Mittelpunkt der Leiste) */
  floatPos: { x: number; y: number };
  orient: BarOrient;
  size: BarSize;
  items: ToolItem[];
  /** Deckkraft aus Preset, null = Standard des Stifts */
  opacity: number | null;
  head0: Head;
  head1: Head;
  fillOpacity: number;
  fillHatch: { angle: number; gap: number } | null;
  vanishMs: number;
  /** Zoom-Schreibfeld: Vergrößerung und ob es offen ist (nicht gespeichert) */
  zoomFactor: number;
  zoomWrite: boolean;
  setHeads: (h: Partial<{ head0: Head; head1: Head }>) => void;
  setFill: (f: Partial<{ fillOpacity: number; fillHatch: { angle: number; gap: number } | null }>) => void;
  setVanishMs: (ms: number) => void;
  setZoom: (z: Partial<{ zoomFactor: number; zoomWrite: boolean }>) => void;
  setTool: (t: Tool) => void;
  setPen: (p: PenKind) => void;
  setColor: (c: string) => void;
  setWidth: (w: number) => void;
  setEraser: (m: Partial<{ eraserMode: EraserMode; eraserSize: number }>) => void;
  setFingerDraws: (v: boolean) => void;
  setPointerGrab: (v: boolean) => void;
  setShapeMode: (v: boolean) => void;
  setGridSnap: (v: boolean) => void;
  toggleGuide: (k: GuideKind) => void;
  applyPreset: (p: Preset) => void;
  addPreset: () => void;
  removePreset: (id: string) => void;
  addCustomColor: (c: string) => void;
  setDock: (d: Dock) => void;
  setFloat: (p: { x: number; y: number }) => void;
  setOrient: (o: BarOrient) => void;
  setSize: (s: BarSize) => void;
  setItems: (i: ToolItem[]) => void;
  updatePreset: (id: string, patch: Partial<Omit<Preset, "id">>) => void;
  /** Leiste (Elemente, Lage, Größe, Presets) auf Standard zurücksetzen */
  resetBar: () => void;
}

const KEY = "noteforge-tools";
const MAX_PRESETS = 8;

type Persisted = Pick<ToolsStore, "tool" | "penTool" | "pen" | "color" | "width" | "eraserMode" | "eraserSize" | "fingerDraws" | "pointerGrab" | "gridSnap" | "shapeMode" | "perPen" | "presets" | "customColors" | "dock" | "floatPos" | "orient" | "size" | "items" | "opacity" | "head0" | "head1" | "fillOpacity" | "fillHatch" | "vanishMs" | "zoomFactor">;

function load(): Partial<Persisted> {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Persisted> & { seen?: string[] };
    // Neue Leisten-Elemente einmalig in gespeicherte Leisten aufnehmen
    if (p.items && !(p.seen ?? []).includes("molecule") && !p.items.includes("molecule")) {
      const i = p.items.indexOf("insert");
      p.items = [...p.items.slice(0, i + 1), "molecule", ...p.items.slice(i + 1)];
    }
    // v0.2.9: Leiste wandert einmalig von „Oben“ als Insel in die Kopfzeile
    if (p.items && !(p.seen ?? []).includes("fit") && !p.items.includes("fit")) {
      const i = p.items.indexOf("zoom");
      p.items = i < 0 ? [...p.items, "fit"] : [...p.items.slice(0, i + 1), "fit", ...p.items.slice(i + 1)];
    }
    if (p.items && !(p.seen ?? []).includes("fitpage") && !p.items.includes("fitpage")) {
      const i = p.items.indexOf("fit");
      p.items = i < 0 ? [...p.items, "fitpage"] : [...p.items.slice(0, i + 1), "fitpage", ...p.items.slice(i + 1)];
    }
    // Wie OneNote: jedes Mal mit „Greifen“ starten; das gewählte Stift-Werkzeug merken
    const pt = p.penTool ?? p.tool;
    // Laser/verschwindende Tinte nicht als Rücksprung-Werkzeug merken
    p.penTool = pt && INK_TOOLS.includes(pt) && pt !== "laser" && pt !== "vanish" ? pt : "pen";
    p.tool = "pan";
    if (p.dock === "top" && !(p.seen ?? []).includes("island")) p.dock = "header";
    return p;
  } catch {
    return {};
  }
}

const perPenDefault = Object.fromEntries(
  Object.entries(PENS).map(([k, d]) => [k, { color: k === "highlighter" ? "#fde047" : "#1e3a8a", width: d.defaultWidth }]),
) as Record<PenKind, { color: string; width: number }>;

export const useTools = create<ToolsStore>((set, get) => ({
  tool: "pan",
  penTool: "pen",
  pen: "fountain",
  color: "#1e3a8a",
  width: 2.5,
  eraserMode: "stroke",
  eraserSize: 14,
  fingerDraws: true,
  pointerGrab: true,
  gridSnap: false,
  shapeMode: false,
  guides: { ruler: false, setsquare: false, compass: false },
  perPen: perPenDefault,
  presets: DEFAULT_PRESETS,
  customColors: [],
  // Außerhalb des Vollbilds als „Insel“ in der Kopfzeile (im Fokusmodus automatisch oben)
  dock: "header",
  floatPos: { x: 0.5, y: 0.2 },
  orient: "horizontal",
  size: "m",
  items: DEFAULT_ITEMS,
  opacity: null,
  head0: "none",
  head1: "none",
  fillOpacity: 0.35,
  fillHatch: null,
  vanishMs: 2000,
  zoomFactor: 3,
  ...load(),
  zoomWrite: false,
  setHeads: (h) => set(h),
  setFill: (f) => set({ ...f, tool: "fill" }),
  setVanishMs: (vanishMs) => set({ vanishMs }),
  setZoom: (z) => set(z),

  setTool: (tool) => set(INK_TOOLS.includes(tool) ? { tool, penTool: tool } : { tool }),
  setPen: (pen) => {
    const pp = get().perPen[pen];
    set({ tool: "pen", penTool: "pen", pen, color: pp.color, width: pp.width, opacity: null });
  },
  setColor: (color) => set((s) => ({ color, perPen: { ...s.perPen, [s.pen]: { ...s.perPen[s.pen], color } } })),
  setWidth: (width) => set((s) => ({ width, perPen: { ...s.perPen, [s.pen]: { ...s.perPen[s.pen], width } } })),
  setEraser: (m) => set({ tool: "eraser", penTool: "eraser", ...m }),
  setFingerDraws: (fingerDraws) => set({ fingerDraws }),
  setPointerGrab: (pointerGrab) => set({ pointerGrab }),
  setShapeMode: (shapeMode) => set({ shapeMode }),
  setGridSnap: (gridSnap) => set({ gridSnap }),
  toggleGuide: (k) => set((s) => ({ guides: { ...s.guides, [k]: !s.guides[k] } })),
  applyPreset: (p) =>
    set((s) => ({ tool: "pen", penTool: "pen", pen: p.pen, color: p.color, width: p.width, opacity: p.opacity ?? null, perPen: { ...s.perPen, [p.pen]: { color: p.color, width: p.width } } })),
  addPreset: () =>
    set((s) =>
      s.presets.length >= MAX_PRESETS ? s : { presets: [...s.presets, { id: crypto.randomUUID(), pen: s.pen, color: s.color, width: s.width, ...(s.opacity != null ? { opacity: s.opacity } : {}) }] },
    ),
  removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
  addCustomColor: (c) => set((s) => ({ customColors: [c, ...s.customColors.filter((x) => x !== c)].slice(0, 12) })),
  setDock: (dock) => set((s) => ({ dock, orient: dock === "left" || dock === "right" ? "vertical" : dock === "float" ? s.orient : "horizontal" })),
  setFloat: (floatPos) => set({ dock: "float", floatPos }),
  // Ausrichtung passend zur Kante: vertikal oben/unten → links andocken, horizontal links/rechts → oben
  setOrient: (orient) => set((s) => ({
    orient,
    dock: orient === "vertical" && (s.dock === "top" || s.dock === "bottom" || s.dock === "header") ? "left" : orient === "horizontal" && (s.dock === "left" || s.dock === "right") ? "top" : s.dock,
  })),
  setSize: (size) => set({ size }),
  setItems: (items) => set({ items: items.filter((i, k) => TOOL_ITEMS.includes(i) && items.indexOf(i) === k) }),
  updatePreset: (id, patch) => set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  resetBar: () => set({ items: DEFAULT_ITEMS, dock: "header", orient: "horizontal", size: "m", floatPos: { x: 0.5, y: 0.2 }, presets: DEFAULT_PRESETS }),
}));

export const MAX_PRESET_COUNT = MAX_PRESETS;

useTools.subscribe((s) => {
  const { tool, pen, color, width, eraserMode, eraserSize, fingerDraws, pointerGrab, gridSnap, shapeMode, perPen, presets, customColors, dock, floatPos, orient, size, items, opacity, head0, head1, fillOpacity, fillHatch, vanishMs, zoomFactor } = s;
  try {
    // Laser/verschwindende Tinte nicht als Startwerkzeug merken
    const t = tool === "laser" || tool === "vanish" ? "pen" : tool;
    localStorage.setItem(KEY, JSON.stringify({ tool: t, penTool: s.penTool, pen, color, width, eraserMode, eraserSize, fingerDraws, pointerGrab, gridSnap, shapeMode, perPen, presets, customColors, dock, floatPos, orient, size, items, opacity, head0, head1, fillOpacity, fillHatch, vanishMs, zoomFactor, seen: ["molecule", "island", "fit", "fitpage"] }));
  } catch {
    /* ignorieren */
  }
});

/** Standard-Schraffur: 45°, 3 mm Abstand. */
export const DEFAULT_HATCH = { angle: 45, gap: 3 * MM };
