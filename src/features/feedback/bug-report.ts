// Bug-Reports (SPEC §15): Senden läuft über den Tauri-Befehl `submit_bug_report` (Rust → Supabase).
import { invoke } from "@tauri-apps/api/core";
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
export async function submitBugReport(text: string, send: (d: string) => Promise<string> = defaultSend): Promise<string> {
  const err = validateBugReport(text);
  if (err) throw new Error(err);
  try {
    return await send(text.trim());
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

const defaultSend = (description: string): Promise<string> =>
  inTauri
    ? invoke<string>("submit_bug_report", { description })
    : Promise.resolve("Danke! (Vorschau ohne App: Bericht wurde nicht gesendet.)");
