import { create } from "zustand";
import { useNav } from "./nav";

/** Bedien-Einstellungen dieses Geräts (nicht synchronisiert). */
interface Prefs {
  /** Linkshänder: Seitenleiste rechts, Werkzeugleiste gespiegelt, Menüs links vom Stift. */
  leftHanded: boolean;
  /** Leistungsanzeige auf dem Canvas */
  perfOverlay: boolean;
  /** Debug-Modus: Rohpunkte/Druck/Umriss + FPS (Strg+Umschalt+D, nicht gespeichert) */
  inkDebug: boolean;
  setInkDebug: (v: boolean) => void;
  /** Fokusmodus: nur Blatt + Werkzeugleiste (nicht gespeichert) */
  focus: boolean;
  /** Offene globale Dialoge */
  dialog: "settings" | "shortcuts" | "palette" | null;
  setDialog: (d: Prefs["dialog"]) => void;
  setLeftHanded: (v: boolean) => void;
  setPerfOverlay: (v: boolean) => void;
  setFocus: (v: boolean) => void;
}

const KEY = "noteforge-prefs";

function load(): Partial<Pick<Prefs, "leftHanded" | "perfOverlay">> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function save(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ leftHanded: p.leftHanded, perfOverlay: p.perfOverlay }));
  } catch {
    /* privat/gesperrt: nur für diese Sitzung */
  }
}

export const usePrefs = create<Prefs>((set, get) => ({
  leftHanded: false,
  perfOverlay: false,
  focus: false,
  inkDebug: false,
  dialog: null,
  ...load(),
  setDialog: (dialog) => set({ dialog }),
  setLeftHanded: (leftHanded) => { set({ leftHanded }); save(get()); },
  setPerfOverlay: (perfOverlay) => { set({ perfOverlay }); save(get()); },
  setFocus: (focus) => set({ focus }),
  setInkDebug: (inkDebug) => set({ inkDebug }),
}));

/** Fokusmodus: nur Blatt + Werkzeugleiste; in der App zusätzlich Vollbild. */
export function toggleFocus(on?: boolean) {
  const p = usePrefs.getState();
  const next = on ?? !p.focus;
  const r = useNav.getState().route;
  if (next && !(r.view === "subject" && r.pageId)) return;
  if (next === p.focus) return;
  p.setFocus(next);
  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(next)).catch(console.error);
  }
}
