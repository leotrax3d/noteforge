import { create } from "zustand";
import type { PenKind } from "@/canvas/core/model";
import { PENS } from "@/canvas/core/pens";
import type { EraserMode, Tool, ToolState } from "@/canvas/core/engine";

export interface Preset {
  id: string;
  pen: PenKind;
  color: string;
  width: number;
}

export type Dock = "top" | "bottom" | "left" | "right";

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
  setTool: (t: Tool) => void;
  setPen: (p: PenKind) => void;
  setColor: (c: string) => void;
  setWidth: (w: number) => void;
  setEraser: (m: Partial<{ eraserMode: EraserMode; eraserSize: number }>) => void;
  setFingerDraws: (v: boolean) => void;
  applyPreset: (p: Preset) => void;
  addPreset: () => void;
  removePreset: (id: string) => void;
  addCustomColor: (c: string) => void;
  setDock: (d: Dock) => void;
}

const KEY = "noteforge-tools";
const MAX_PRESETS = 8;

type Persisted = Pick<ToolsStore, "tool" | "pen" | "color" | "width" | "eraserMode" | "eraserSize" | "fingerDraws" | "perPen" | "presets" | "customColors" | "dock">;

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
  perPen: perPenDefault,
  presets: DEFAULT_PRESETS,
  customColors: [],
  dock: "top",
  ...load(),

  setTool: (tool) => set({ tool }),
  setPen: (pen) => {
    const pp = get().perPen[pen];
    set({ tool: "pen", pen, color: pp.color, width: pp.width });
  },
  setColor: (color) => set((s) => ({ color, perPen: { ...s.perPen, [s.pen]: { ...s.perPen[s.pen], color } } })),
  setWidth: (width) => set((s) => ({ width, perPen: { ...s.perPen, [s.pen]: { ...s.perPen[s.pen], width } } })),
  setEraser: (m) => set({ tool: "eraser", ...m }),
  setFingerDraws: (fingerDraws) => set({ fingerDraws }),
  applyPreset: (p) =>
    set((s) => ({ tool: "pen", pen: p.pen, color: p.color, width: p.width, perPen: { ...s.perPen, [p.pen]: { color: p.color, width: p.width } } })),
  addPreset: () =>
    set((s) =>
      s.presets.length >= MAX_PRESETS ? s : { presets: [...s.presets, { id: crypto.randomUUID(), pen: s.pen, color: s.color, width: s.width }] },
    ),
  removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
  addCustomColor: (c) => set((s) => ({ customColors: [c, ...s.customColors.filter((x) => x !== c)].slice(0, 12) })),
  setDock: (dock) => set({ dock }),
}));

export const MAX_PRESET_COUNT = MAX_PRESETS;

useTools.subscribe((s) => {
  const { tool, pen, color, width, eraserMode, eraserSize, fingerDraws, perPen, presets, customColors, dock } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify({ tool, pen, color, width, eraserMode, eraserSize, fingerDraws, perPen, presets, customColors, dock }));
  } catch {
    /* ignorieren */
  }
});
