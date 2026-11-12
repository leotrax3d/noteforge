// Leistungsmodus im Akkubetrieb (SPEC §10.4): Netz-/Akkustatus über die Battery Status API (WebView2/Chromium).
// Im Sparmodus werden Animationen/Übergänge reduziert und Hintergrund-Erkennung gedrosselt;
// das Stift-Rendering bleibt immer in voller Qualität.
import { create } from "zustand";

export type PowerSetting = "auto" | "on" | "off";

interface BatteryLike extends EventTarget { charging: boolean; level: number }

interface PowerStore {
  setting: PowerSetting;
  /** null = unbekannt (kein Akku/keine API) */
  onBattery: boolean | null;
  setSetting: (s: PowerSetting) => void;
}

const KEY = "noteforge-power";
const load = (): PowerSetting => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "auto";
  } catch {
    return "auto";
  }
};

export const usePower = create<PowerStore>((set) => ({
  setting: load(),
  onBattery: null,
  setSetting: (setting) => {
    try { localStorage.setItem(KEY, setting); } catch { /* egal */ }
    set({ setting });
    applySaver();
  },
}));

export function powerSaving(s: Pick<PowerStore, "setting" | "onBattery"> = usePower.getState()): boolean {
  return s.setting === "on" || (s.setting === "auto" && s.onBattery === true);
}

/** Hintergrundarbeit (OCR/Handschrift) seltener ausführen. */
export const shouldThrottleBackground = () => powerSaving();
/** Faktor für Verzögerungen von Hintergrundaufgaben. */
export const backgroundDelayFactor = () => (powerSaving() ? 4 : 1);

function applySaver() {
  if (typeof document === "undefined") return;
  document.documentElement.toggleAttribute("data-power-saver", powerSaving());
}

/** Einmal beim Start: Akkustatus beobachten. */
export async function initPower() {
  applySaver();
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (!nav.getBattery) return;
  try {
    const b = await nav.getBattery();
    const update = () => { usePower.setState({ onBattery: !b.charging }); applySaver(); };
    update();
    b.addEventListener("chargingchange", update);
  } catch {
    /* keine Akku-Info */
  }
}
