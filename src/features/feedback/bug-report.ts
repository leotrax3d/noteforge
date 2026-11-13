// Bug-Reports (SPEC §15): Senden läuft über den Tauri-Befehl `submit_bug_report` (Rust → Supabase).
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { inTauri } from "@/lib/api";

export const BUG_MIN = 10;
export const BUG_MAX = 5000;

/** Fehlertext für die Eingabe oder null, wenn sie gesendet werden darf. */
export function validateBugReport(text: string): string | null {
  const n = [...text.trim()].length;
  if (n < BUG_MIN) return `Bitte beschreibe den Fehler etwas genauer (mindestens ${BUG_MIN} Zeichen).`;
  if (n > BUG_MAX) return `Die Beschreibung ist zu lang (höchstens ${BUG_MAX} Zeichen).`;
  return null;
}

/** Sendet den Bericht; liefert die Erfolgsmeldung oder wirft eine deutsche Fehlermeldung. */
export async function submitBugReport(text: string, screenshot: string | null = null,
  send: (d: string, shot: string | null) => Promise<string> = defaultSend): Promise<string> {
  const err = validateBugReport(text);
  if (err) throw new Error(err);
  try {
    return await send(text.trim(), screenshot);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

const defaultSend = (description: string, screenshot: string | null): Promise<string> =>
  inTauri
    ? invoke<string>("submit_bug_report", { description, screenshotB64: screenshot })
    : Promise.resolve("Danke! (Vorschau ohne App: Bericht wurde nicht gesendet.)");

/** Größte Kantenlänge des Bildschirmfotos; JPEG bleibt so deutlich unter 2 MB. */
export const SHOT_MAX = 1600;

/** Skalierung, damit die längere Seite höchstens `max` Pixel hat (nie vergrößern). */
export function shotScale(w: number, h: number, max = SHOT_MAX): number {
  const m = Math.max(w, h);
  return m > max ? max / m : 1;
}

/** Bildschirmfoto der aktuellen Ansicht als JPEG-Data-URL (null, wenn es nicht klappt). */
export async function captureView(): Promise<string | null> {
  try {
    const { domToJpeg } = await import("modern-screenshot");
    const el = document.body;
    const url = await domToJpeg(el, {
      quality: 0.8, scale: shotScale(el.clientWidth, el.clientHeight) * Math.min(2, window.devicePixelRatio || 1),
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#fff",
      filter: (n) => !(n instanceof HTMLElement && n.dataset.noShot != null),
    });
    return url.length > 2.6e6 ? null : url; // > ~2 MB Base64 → weglassen
  } catch (e) {
    console.warn("Bildschirmfoto fehlgeschlagen", e);
    return null;
  }
}

/** Global: Dialog öffnen und vorher die aktuelle Ansicht fotografieren. */
export const useBugReport = create<{ open: boolean; shot: string | null; show: () => Promise<void>; close: () => void }>((set) => ({
  open: false, shot: null,
  show: async () => { const shot = await captureView(); set({ open: true, shot }); },
  close: () => set({ open: false, shot: null }),
}));
