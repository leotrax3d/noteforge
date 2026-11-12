import { create } from "zustand";
import type { AngleMode } from "./math";
import type { PlotSpec } from "./plot";

export interface CalcHost {
  /** Graph als editierbares Bild einfügen bzw. das ausgewählte ersetzen (`replace`). */
  insertPlot(spec: PlotSpec, svg: string, replace: boolean): void;
  /** Rechnung als Textfeld einfügen. */
  insertText(text: string): void;
}
export interface HistoryItem { expr: string; text: string }

interface CalcState {
  open: boolean;
  tab: "calc" | "plot";
  mode: AngleMode;
  history: HistoryItem[];
  /** Graph, der im Plotter bearbeitet wird (beim Öffnen übernommen) */
  spec: PlotSpec | null;
  /** true = ausgewählter Graph auf dem Blatt wird ersetzt */
  editing: boolean;
  host: CalcHost | null;
  toggle(open?: boolean): void;
  setTab(t: "calc" | "plot"): void;
  setMode(m: AngleMode): void;
  push(h: HistoryItem): void;
  clearHistory(): void;
  openPlot(spec: PlotSpec | null, editing: boolean): void;
  setSpec(s: PlotSpec): void;
  setHost(h: CalcHost | null): void;
}

export const useCalc = create<CalcState>((set, get) => ({
  open: false, tab: "calc", mode: "deg", history: [], spec: null, editing: false, host: null,
  toggle: (open) => set({ open: open ?? !get().open, ...(open === false || get().open ? { editing: false } : {}) }),
  setTab: (tab) => set({ tab }),
  setMode: (mode) => set({ mode }),
  push: (h) => set((s) => ({ history: [...s.history, h].slice(-100) })),
  clearHistory: () => set({ history: [] }),
  openPlot: (spec, editing) => set((s) => ({ open: true, tab: "plot", spec: spec ? structuredClone(spec) : s.spec, editing })),
  setSpec: (spec) => set({ spec }),
  setHost: (host) => set({ host }),
}));

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
