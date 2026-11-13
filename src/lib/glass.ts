// Designschema „Glas“ (SPEC §7.1): halbtransparente, weichgezeichnete Flächen über farbigem Hintergrund.
// Einstellungen sind gerätelokal (wie Hell/Dunkel). Das Fenstermaterial (Mica/Acrylic) wird zusätzlich
// über einen Tauri-Befehl gespeichert, damit Rust es vor dem Anzeigen des Fensters setzen kann.
import { create } from "zustand";
import { powerSaving, usePower } from "./power";

export type Material = "mica" | "acrylic" | "off";
export type SaverBlur = "keep" | "reduce" | "off";

export interface GlassSettings {
  enabled: boolean;
  /** Deckkraft der Glasflächen 0,2–0,95 */
  opacity: number;
  /** Weichzeichnung in px (0–48) */
  blur: number;
  material: Material;
  /** Hintergrund: Preset-ID, "custom" (eigenes Bild) oder "none" */
  background: string;
  /** Kennung des eigenen Bilds (ändert sich bei jedem Hochladen); das Bild selbst liegt in `app.glassImage` */
  customAsset: string | null;
  /** Akzentfarbe aus dem Hintergrund ableiten */
  autoAccent: boolean;
  /** Im Akku-Leistungsmodus */
  saverBlur: SaverBlur;
  /** App-Einstellung „Animationen reduzieren“ */
  reduceMotion: boolean;
}

export const GLASS_DEFAULTS: GlassSettings = {
  enabled: false, opacity: 0.55, blur: 24, material: "mica", background: "aurora", customAsset: null,
  autoAccent: false, saverBlur: "reduce", reduceMotion: false,
};

/** Mitgelieferte abstrakte Verläufe; `stops` sind die Grundfarben (für Kontrast und Akzent). */
export const BACKGROUNDS: { id: string; label: string; css: string; stops: string[]; accent: string }[] = [
  { id: "aurora", label: "Polarlicht", accent: "#7c3aed", stops: ["#1e1b4b", "#7c3aed", "#06b6d4", "#22c55e"],
    css: "radial-gradient(60% 70% at 15% 20%, #7c3aed 0%, transparent 60%), radial-gradient(50% 60% at 85% 30%, #06b6d4 0%, transparent 60%), radial-gradient(60% 60% at 60% 90%, #22c55e 0%, transparent 60%), #1e1b4b" },
  { id: "sunset", label: "Abendrot", accent: "#ea580c", stops: ["#3b0a2a", "#f97316", "#db2777", "#facc15"],
    css: "radial-gradient(70% 60% at 20% 80%, #f97316 0%, transparent 60%), radial-gradient(60% 60% at 80% 20%, #db2777 0%, transparent 60%), radial-gradient(40% 40% at 60% 60%, #facc15 0%, transparent 70%), #3b0a2a" },
  { id: "ocean", label: "Ozean", accent: "#0284c7", stops: ["#0c1a3a", "#0284c7", "#14b8a6", "#6366f1"],
    css: "radial-gradient(60% 60% at 25% 30%, #0284c7 0%, transparent 60%), radial-gradient(60% 70% at 80% 70%, #14b8a6 0%, transparent 60%), radial-gradient(40% 40% at 70% 15%, #6366f1 0%, transparent 70%), #0c1a3a" },
  { id: "forest", label: "Wald", accent: "#16a34a", stops: ["#0b1f14", "#16a34a", "#84cc16", "#0d9488"],
    css: "radial-gradient(60% 60% at 20% 25%, #16a34a 0%, transparent 60%), radial-gradient(50% 60% at 85% 75%, #84cc16 0%, transparent 60%), radial-gradient(50% 50% at 50% 50%, #0d9488 0%, transparent 70%), #0b1f14" },
  { id: "mono", label: "Graphit", accent: "#64748b", stops: ["#111827", "#475569", "#94a3b8"],
    css: "radial-gradient(60% 60% at 30% 30%, #475569 0%, transparent 60%), radial-gradient(60% 60% at 75% 75%, #94a3b8 0%, transparent 60%), #111827" },
];

// ---------- Kontrast (WCAG 2.1) ----------

type RGB = [number, number, number];
export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB;
}
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const mix = (top: RGB, under: RGB, a: number): RGB => top.map((c, i) => c * a + under[i] * (1 - a)) as RGB;

/** Glas-Grundfarben und (gedämpfte) Textfarben je Modus. */
export const TINT: Record<"light" | "dark", { glass: RGB; text: RGB; muted: RGB; dim: RGB; dimAlpha: number }> = {
  dark: { glass: [20, 20, 24], text: [250, 250, 250], muted: [161, 161, 170], dim: [0, 0, 0], dimAlpha: 0.45 },
  light: { glass: [255, 255, 255], text: [10, 10, 10], muted: [82, 82, 91], dim: [255, 255, 255], dimAlpha: 0.55 },
};

/** Hintergrundfarben, wie sie hinter dem Glas ankommen (nach Abdunkeln/Aufhellen des Hintergrunds). */
export function backdropColors(stops: string[], mode: "light" | "dark"): RGB[] {
  const t = TINT[mode];
  return stops.map((s) => mix(t.dim, hexToRgb(s), t.dimAlpha));
}

/**
 * Kleinste Deckkraft, bei der normaler und gedämpfter Text auf jedem Hintergrundton mindestens 4,5:1 erreicht.
 * Liefert mindestens `wanted` (Benutzerwert) – die Deckkraft wird nur erhöht, nie gesenkt.
 */
export function safeOpacity(wanted: number, backdrops: RGB[], mode: "light" | "dark", ratio = 4.5): number {
  const t = TINT[mode];
  for (let a = Math.max(0, wanted); a <= 1.0001; a += 0.01) {
    const ok = backdrops.every((b) => {
      const bg = mix(t.glass, b, a);
      return contrast(t.text, bg) >= ratio && contrast(t.muted, bg) >= ratio;
    });
    if (ok) return Math.round(a * 100) / 100;
  }
  return 1;
}

/** Ungefähre Farben hinter dem Glas, wenn kein eigener Hintergrund gewählt ist (Mica-Tönung bzw. App-Hintergrund). */
const PLAIN: Record<"light" | "dark", string[]> = { dark: ["#202020", "#0a0a0a"], light: ["#f3f3f3", "#ffffff"] };

// ---------- Store ----------

const KEY = "noteforge-glass";
function load(): GlassSettings {
  try { return { ...GLASS_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...GLASS_DEFAULTS }; }
}

interface GlassStore extends GlassSettings {
  /** Farbtöne des eigenen Bilds (für Kontrast) */
  customStops: string[];
  /** System: Transparenzeffekte aus bzw. Kontrastmodus */
  systemBlocked: boolean;
  set: (p: Partial<GlassSettings>) => void;
}

export const useGlass = create<GlassStore>((set, get) => ({
  ...load(),
  customStops: [],
  systemBlocked: false,
  set: (p) => {
    set(p);
    const { set: _s, customStops: _c, systemBlocked: _b, ...rest } = get();
    try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* nur Sitzung */ }
    applyGlass();
    if ("material" in p || "enabled" in p) void persistMaterial();
  },
}));

export function glassActive(s = useGlass.getState()): boolean {
  return s.enabled && !s.systemBlocked;
}

export function bgStops(s = useGlass.getState(), mode: "light" | "dark"): string[] {
  if (s.background === "custom") return s.customStops.length ? s.customStops : PLAIN[mode];
  return BACKGROUNDS.find((b) => b.id === s.background)?.stops ?? PLAIN[mode];
}

const supportsBackdrop = () => typeof CSS !== "undefined" && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));

/** Wirksame Werte: Kontrast-Untergrenze, Akkumodus und fehlende Unterstützung. */
export function effective(s = useGlass.getState(), mode: "light" | "dark", saving = powerSaving(), backdropOk = true) {
  let blur = s.blur;
  if (saving) blur = s.saverBlur === "off" ? 0 : s.saverBlur === "reduce" ? Math.min(blur, 8) : blur;
  if (!backdropOk) blur = 0;
  const backdrops = s.background === "none" ? PLAIN[mode].map(hexToRgb) : backdropColors(bgStops(s, mode), mode);
  // Ohne Weichzeichnung schimmert der Hintergrund ungefiltert durch → deutlich deckender
  const wanted = blur === 0 ? Math.max(s.opacity, 0.85) : s.opacity;
  return { blur, opacity: safeOpacity(wanted, backdrops, mode) };
}

function mode(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Setzt Klassen und CSS-Variablen am Wurzelelement. */
export function applyGlass() {
  if (typeof document === "undefined") return;
  const s = useGlass.getState();
  const r = document.documentElement;
  const on = glassActive(s);
  r.classList.toggle("glass", on);
  r.toggleAttribute("data-reduce-motion", s.reduceMotion);
  if (!on) { r.removeAttribute("data-glass-bg"); return; }
  const m = mode();
  const e = effective(s, m, powerSaving(), supportsBackdrop());
  r.classList.toggle("glass-solid", e.blur === 0);
  r.style.setProperty("--glass-alpha", String(e.opacity));
  r.style.setProperty("--glass-blur", `${e.blur}px`);
  r.dataset.glassBg = s.background;
  r.toggleAttribute("data-material", s.material !== "off" && inTauriWin());
}

const inTauriWin = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Fenstermaterial speichern und anwenden (Rust setzt es beim nächsten Start vor dem Anzeigen). */
export async function persistMaterial() {
  if (!inTauriWin()) return;
  const s = useGlass.getState();
  const { invoke } = await import("@tauri-apps/api/core");
  const material = glassActive(s) ? s.material : "off";
  const dark = mode() === "dark";
  await invoke("set_app_setting", { key: "app.windowMaterial", value: material }).catch(() => {});
  await invoke("set_app_setting", { key: "app.windowDark", value: dark ? "1" : "0" }).catch(() => {});
  await invoke("set_window_material", { material, dark }).catch(console.error);
}

/** Kräftigste Farben eines Bilds (für Kontrast und Akzentfarbe), grob über ein 24×24-Raster. */
export async function imageStops(url: string): Promise<{ stops: string[]; accent: string }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return { stops: [], accent: "#2563eb" };
  g.drawImage(img, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  const px: RGB[] = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  const hex = (p: RGB) => "#" + p.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const sat = ([r, g2, b]: RGB) => Math.max(r, g2, b) - Math.min(r, g2, b);
  const byLum = [...px].sort((a, b) => luminance(a) - luminance(b));
  const pick = (f: number) => byLum[Math.min(byLum.length - 1, Math.floor(f * byLum.length))];
  const accent = [...px].sort((a, b) => sat(b) - sat(a))[0] ?? [37, 99, 235];
  return { stops: [pick(0.02), pick(0.25), pick(0.5), pick(0.75), pick(0.98)].map(hex), accent: hex(accent) };
}

// ---------- Eigenes Hintergrundbild ----------

let memImage: string | null = null;
/** Bild verkleinern (max. 1920 px, JPEG) und über Tauri speichern. */
export async function saveGlassImage(file: Blob): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", 0.85);
    if (inTauriWin()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_app_setting", { key: "app.glassImage", value: data });
    } else memImage = data;
    useGlass.getState().set({ background: "custom", customAsset: String(Date.now()) });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function loadGlassImage(): Promise<string | null> {
  if (!inTauriWin()) return memImage;
  const { invoke } = await import("@tauri-apps/api/core");
  const all = await invoke<Record<string, string>>("app_settings");
  return all["app.glassImage"] ?? null;
}

// ---------- Günstiger Modus beim Schreiben ----------

/**
 * Schwebende Glasflächen über dem Canvas (`data-glass-float`) verlieren während des Schreibens die
 * Weichzeichnung (fester halbtransparenter Hintergrund) und bekommen sie danach weich zurück.
 * Kein React-State, keine Änderung am Wurzelelement: nur ein Attribut an den wenigen schwebenden Elementen.
 */
export function startInkWatcher(): () => void {
  let timer: number | undefined;
  let inking = false;
  const setCheap = (on: boolean) => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-glass-float]")) el.toggleAttribute("data-cheap", on);
  };
  const down = (e: PointerEvent) => {
    if (!(e.target instanceof HTMLCanvasElement) || !document.documentElement.classList.contains("glass")) return;
    window.clearTimeout(timer);
    if (!inking) { inking = true; setCheap(true); }
  };
  const up = () => {
    if (!inking) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { inking = false; setCheap(false); }, 700);
  };
  window.addEventListener("pointerdown", down, { capture: true, passive: true });
  window.addEventListener("pointerup", up, { capture: true, passive: true });
  window.addEventListener("pointercancel", up, { capture: true, passive: true });
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
  };
}

/** Systemeinstellungen beobachten: Transparenzeffekte aus, Kontrastmodus, Akkumodus. */
export async function initGlass() {
  const mq = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);
  const queries = ["(prefers-reduced-transparency: reduce)", "(forced-colors: active)", "(prefers-contrast: more)"].map(mq);
  let winBlocked = false;
  const update = () => {
    useGlass.setState({ systemBlocked: winBlocked || queries.some((q) => q?.matches) });
    applyGlass();
  };
  queries.forEach((q) => q?.addEventListener?.("change", update));
  usePower.subscribe(applyGlass);
  let dark = mode();
  new MutationObserver(() => {
    applyGlass();
    if (mode() !== dark) { dark = mode(); if (glassActive()) void persistMaterial(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  update();
  if (inTauriWin()) {
    const { invoke } = await import("@tauri-apps/api/core");
    winBlocked = !(await invoke<boolean>("system_transparency").catch(() => true));
    update();
  }
}
