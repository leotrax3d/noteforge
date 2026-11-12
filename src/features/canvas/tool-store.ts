import { create } from "zustand";
import type { PenKind } from "@/canvas/core/model";
import { PENS } from "@/canvas/core/pens";
import type { EraserMode, Tool, ToolState } from "@/canvas/core/engine";
import type { GuideKind } from "@/canvas/tools/guides";

export interface Preset {
  id: string;
  pen: PenKind;
  color: string;
  width: number;
  /** Deckkraft 0..1; fehlt = Standard des Stifts */
  opacity?: number;
}

export type Dock = "top" | "bottom" | "left" | "right" | "float";
export type BarOrient = "horizontal" | "vertical";
export type BarSize = "s" | "m" | "l";

/** Elemente der Stiftleiste (Reihenfolge = Anzeige). */
export const TOOL_ITEMS = [
  "fountain", "ballpoint", "pencil", "highlighter", "eraser", "lasso", "pan", "text", "guides", "insert",
  "presets", "undo", "redo", "zoom", "page", "calc", "plot", "image",
] as const;
export type ToolItem = (typeof TOOL_ITEMS)[number];
export const DEFAULT_ITEMS: ToolItem[] = [
  "fountain", "ballpoint", "pencil", "highlighter", "eraser", "lasso", "pan", "text", "guides", "insert",
  "presets", "undo", "redo", "zoom", "page",
];

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
  setTool: (t: Tool) => void;
  setPen: (p: PenKind) => void;
  setColor: (c: string) => void;
  setWidth: (w: number) => void;
  setEraser: (m: Partial<{ eraserMode: EraserMode; eraserSize: number }>) => void;
  setFingerDraws: (v: boolean) => void;
  setShapeMode: (v: boolean) => void;
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

type Persisted = Pick<ToolsStore, "tool" | "pen" | "color" | "width" | "eraserMode" | "eraserSize" | "fingerDraws" | "shapeMode" | "perPen" | "presets" | "customColors" | "dock" | "floatPos" | "orient" | "size" | "items" | "opacity">;

function load(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Persisted>;
  } catch {
    return {};
  }
}

const perPenDefault = Object.fromEntries(
  Object.entries(PENS).map(([k, d]) => [k, { color: k === "highlighter" ? "#fde047" : "#1e3a8a", width: d.defaultWidth }]),
) as Record<PenKind, { color: string; width: number }>;

export const useTools = create<ToolsStore>((set, get) => ({
  tool: "pen",
  pen: "fountain",
  color: "#1e3a8a",
  width: 2.5,
  eraserMode: "stroke",
  eraserSize: 14,
  fingerDraws: true,
  shapeMode: false,
  guides: { ruler: false, setsquare: false, compass: false },
  perPen: perPenDefault,
  presets: DEFAULT_PRESETS,
  customColors: [],
  dock: "top",
  floatPos: { x: 0.5, y: 0.2 },
  orient: "horizontal",
  size: "m",
  items: DEFAULT_ITEMS,
  opacity: null,
  ...load(),

  setTool: (tool) => set({ tool }),
  setPen: (pen) => {
    const pp = get().perPen[pen];
    set({ tool: "pen", pen, color: pp.color, width: pp.width, opacity: null });
  },
  setColor: (color) => set((s) => ({ color, perPen: { ...s.perPen, [s.pen]: { ...s.perPen[s.pen], color } } })),
  setWidth: (width) => set((s) => ({ width, perPen: { ...s.perPen, [s.pen]: { ...s.perPen[s.pen], width } } })),
  setEraser: (m) => set({ tool: "eraser", ...m }),
  setFingerDraws: (fingerDraws) => set({ fingerDraws }),
  setShapeMode: (shapeMode) => set({ shapeMode }),
  toggleGuide: (k) => set((s) => ({ guides: { ...s.guides, [k]: !s.guides[k] } })),
  applyPreset: (p) =>
    set((s) => ({ tool: "pen", pen: p.pen, color: p.color, width: p.width, opacity: p.opacity ?? null, perPen: { ...s.perPen, [p.pen]: { color: p.color, width: p.width } } })),
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
    dock: orient === "vertical" && (s.dock === "top" || s.dock === "bottom") ? "left" : orient === "horizontal" && (s.dock === "left" || s.dock === "right") ? "top" : s.dock,
  })),
  setSize: (size) => set({ size }),
  setItems: (items) => set({ items: items.filter((i, k) => TOOL_ITEMS.includes(i) && items.indexOf(i) === k) }),
  updatePreset: (id, patch) => set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  resetBar: () => set({ items: DEFAULT_ITEMS, dock: "top", orient: "horizontal", size: "m", floatPos: { x: 0.5, y: 0.2 }, presets: DEFAULT_PRESETS }),
}));

export const MAX_PRESET_COUNT = MAX_PRESETS;

useTools.subscribe((s) => {
  const { tool, pen, color, width, eraserMode, eraserSize, fingerDraws, shapeMode, perPen, presets, customColors, dock, floatPos, orient, size, items, opacity } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify({ tool, pen, color, width, eraserMode, eraserSize, fingerDraws, shapeMode, perPen, presets, customColors, dock, floatPos, orient, size, items, opacity }));
  } catch {
    /* ignorieren */
  }
});
