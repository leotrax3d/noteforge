import { create } from "zustand";
import type { PageBackground, PageMode } from "@/lib/types";

/** Was die Stifttaste (Seitentaste) auslöst. */
export type BarrelAction = "lasso" | "eraser" | "radial";

/** Einstellungen aus dem Einrichtungsassistenten (gerätelokal). */
export interface SetupState {
  /** Assistent abgeschlossen */
  done: boolean;
  /** Zuletzt offener Schritt (fortsetzbar) */
  step: number;
  /** Akzentfarbe der Oberfläche, null = Standard */
  accent: string | null;
  /** Druckkurve: Exponent (1 = linear, < 1 = weicher) und Druck, der als „voll“ gilt */
  pressureGamma: number;
  pressureMax: number;
  barrel: BarrelAction;
  /** Standard für neue Blätter */
  page: { mode: PageMode; background: PageBackground; spacingMm: number };
  /** Helfer „Spitz“: kurze Hinweise beim ersten Benutzen eines Werkzeugs */
  spitz: boolean;
  /** Bereits gezeigte Hinweise */
  seenHints: string[];
  /** Standard-Vorlaufzeit für Erinnerungen (Minuten) */
  reminderLead: number;
  set: (p: Partial<Omit<SetupState, "set" | "seeHint">>) => void;
  seeHint: (id: string) => void;
}

export const SETUP_KEY = "noteforge-setup";
export const ACCENT_KEY = "noteforge-accent";

export const SETUP_DEFAULTS = {
  done: false, step: 0, accent: null, pressureGamma: 1, pressureMax: 1, barrel: "lasso" as BarrelAction,
  page: { mode: "infinite" as PageMode, background: "grid" as PageBackground, spacingMm: 5 },
  spitz: true, seenHints: [] as string[], reminderLead: 15,
};

function load(): Partial<SetupState> {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const useSetup = create<SetupState>((set, get) => ({
  ...SETUP_DEFAULTS,
  ...load(),
  set: (p) => {
    set(p);
    persist(get());
    if ("accent" in p) applyAccent(p.accent ?? null);
  },
  seeHint: (id) => {
    if (get().seenHints.includes(id)) return;
    set({ seenHints: [...get().seenHints, id] });
    persist(get());
  },
}));

function persist(s: SetupState) {
  try {
    const { set: _a, seeHint: _b, ...data } = s;
    void _a; void _b;
    localStorage.setItem(SETUP_KEY, JSON.stringify(data));
  } catch {
    /* privat/gesperrt */
  }
}

/** Akzentfarbe als CSS-Variable (auch vor dem React-Mount aus index.html gesetzt). */
export function applyAccent(c: string | null) {
  const r = document.documentElement;
  try {
    if (c) localStorage.setItem(ACCENT_KEY, c);
    else localStorage.removeItem(ACCENT_KEY);
  } catch { /* egal */ }
  if (c) { r.style.setProperty("--accent-user", c); r.classList.add("nf-accent"); }
  else { r.style.removeProperty("--accent-user"); r.classList.remove("nf-accent"); }
}

/** Standard-Blatt für neue Blätter (ohne Store, auch aus api.ts nutzbar). */
export function pageDefaults(): SetupState["page"] {
  return useSetup.getState().page;
}
