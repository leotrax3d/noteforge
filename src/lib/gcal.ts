// Google-Kalender (SPEC §8.3). OAuth, Tokens und Netzwerk liegen komplett im Rust-Backend.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { inTauri } from "./api";
import { useSyncRev } from "./integrations";
import { powerSaving, usePower } from "./power";
import type { CalendarEvent, EventKind } from "./types";

export interface GcalOpts {
  exams: boolean; events: boolean; homework: boolean; homeworkAtLesson: boolean;
  moodle: boolean; timetable: boolean; examReminders: boolean; detectExams: boolean;
}
export const DEFAULT_OPTS: GcalOpts = {
  exams: true, events: true, homework: true, homeworkAtLesson: false, moodle: true, timetable: false, examReminders: true, detectExams: true,
};
export const OPT_LABELS: { key: keyof GcalOpts; label: string }[] = [
  { key: "exams", label: "Klassenarbeiten und Tests" },
  { key: "examReminders", label: "Erinnerungen 7, 3 und 1 Tag vorher" },
  { key: "events", label: "Sonstige Termine aus dem Noteforge-Kalender" },
  { key: "homework", label: "Hausaufgaben mit Fälligkeit" },
  { key: "homeworkAtLesson", label: "Hausaufgaben zur Stunde statt ganztägig" },
  { key: "moodle", label: "Moodle-Abgaben" },
  { key: "timetable", label: "Stundenplan mit Ausfällen und Freistunden" },
  { key: "detectExams", label: "Klassenarbeiten in Google-Terminen erkennen" },
];

export interface SourceCal { id: string; name: string; color: string }
export interface GcalAccount {
  email: string; calendarId: string | null; calendarName: string; opts: GcalOpts; sources: SourceCal[];
  lastSync: number | null; lastError: string | null; pending: number;
}
export interface CalendarInfo { id: string; summary: string; backgroundColor: string | null; accessRole: string; primary: boolean }
export interface GSyncReport { pushed: number; deleted: number; pulled: number; conflicts: number; pending: number; errors: string[]; skipped: boolean }
export interface RemoteEvent {
  account: string; calendarId: string; calendarName: string; color: string; id: string; title: string;
  start: number; end: number | null; allDay: boolean; location: string;
  suggestion: { type: EventKind; subjectId: string | null } | null;
}
export interface HistoryEntry { id: number; event: CalendarEvent; origin: "local" | "google"; reason: string; at: number }

export interface Gcal {
  client(): Promise<{ clientId: string; hasSecret: boolean }>;
  setClient(clientId: string, clientSecret: string | null): Promise<void>;
  status(): Promise<GcalAccount[]>;
  login(): Promise<string>;
  calendars(email: string): Promise<CalendarInfo[]>;
  /** `calendarId` null = eigenen Kalender „Noteforge – Schule“ anlegen. */
  configure(email: string, calendarId: string | null, opts: GcalOpts, sources: SourceCal[]): Promise<void>;
  disconnect(email: string, removeEvents: boolean): Promise<void>;
  sync(): Promise<GSyncReport>;
  events(from: number, to: number): Promise<RemoteEvent[]>;
  adopt(r: RemoteEvent, type: EventKind, subjectId: string | null): Promise<CalendarEvent>;
  dismiss(r: RemoteEvent): Promise<void>;
  history(eventId: string): Promise<HistoryEntry[]>;
  restore(entryId: number): Promise<CalendarEvent>;
}

const tauri: Gcal = {
  client: () => invoke("gcal_client"),
  setClient: (clientId, clientSecret) => invoke("gcal_set_client", { clientId, clientSecret }),
  status: () => invoke("gcal_status"),
  login: () => invoke("gcal_login"),
  calendars: (email) => invoke("gcal_calendars", { email }),
  configure: (email, calendarId, opts, sources) => invoke("gcal_configure", { email, calendarId, opts, sources }),
  disconnect: (email, removeEvents) => invoke("gcal_disconnect", { email, removeEvents }),
  sync: () => invoke("gcal_sync"),
  events: (from, to) => invoke("gcal_events", { from, to }),
  adopt: (r, type, subjectId) => invoke("gcal_adopt", { account: r.account, calendarId: r.calendarId, id: r.id, kind: type, subjectId }),
  dismiss: (r) => invoke("gcal_dismiss", { account: r.account, calendarId: r.calendarId, id: r.id }),
  history: (eventId) => invoke("event_history", { eventId }),
  restore: (entryId) => invoke("event_history_restore", { entryId }),
};

/** Browser/Tests: ohne Netzwerk, Anmeldung wird simuliert. */
export class DemoGcal implements Gcal {
  private clientId = "";
  private accounts: GcalAccount[] = [];
  private remote: RemoteEvent[] = [];
  async client() { return { clientId: this.clientId, hasSecret: false }; }
  async setClient(id: string) {
    if (id.trim() && !id.trim().endsWith(".apps.googleusercontent.com")) throw new Error("Die Client-ID endet auf „.apps.googleusercontent.com“");
    this.clientId = id.trim();
  }
  async status() { return structuredClone(this.accounts); }
  async login() {
    if (!this.clientId) throw new Error("Bitte zuerst in den Einstellungen eine Google-Client-ID eintragen");
    const email = `demo${this.accounts.length || ""}@gmail.com`;
    this.accounts.push({ email, calendarId: null, calendarName: "", opts: { ...DEFAULT_OPTS }, sources: [], lastSync: null, lastError: null, pending: 0 });
    return email;
  }
  async calendars(email: string): Promise<CalendarInfo[]> {
    return [
      { id: email, summary: email, backgroundColor: "#4285f4", accessRole: "owner", primary: true },
      { id: "familie", summary: "Familie", backgroundColor: "#e67c73", accessRole: "reader", primary: false },
      { id: "verein", summary: "Verein", backgroundColor: "#33b679", accessRole: "reader", primary: false },
    ];
  }
  async configure(email: string, calendarId: string | null, opts: GcalOpts, sources: SourceCal[]) {
    const a = this.accounts.find((x) => x.email === email);
    if (!a) throw new Error("Konto nicht gefunden");
    Object.assign(a, { calendarId: calendarId ?? "noteforge", calendarName: calendarId ? (await this.calendars(email)).find((c) => c.id === calendarId)?.summary ?? "" : "Noteforge – Schule", opts, sources });
    const d = new Date(); d.setHours(16, 0, 0, 0);
    this.remote = sources.flatMap((s, i) => [{
      account: email, calendarId: s.id, calendarName: s.name, color: s.color, id: `${s.id}-${i}`,
      title: i === 0 ? "KA Mathe" : "Training", start: d.getTime() + (i + 1) * 86_400_000, end: d.getTime() + (i + 1) * 86_400_000 + 3_600_000,
      allDay: false, location: "", suggestion: null,
    }]);
  }
  async disconnect(email: string) { this.accounts = this.accounts.filter((a) => a.email !== email); this.remote = this.remote.filter((r) => r.account !== email); }
  async sync(): Promise<GSyncReport> {
    for (const a of this.accounts) a.lastSync = Date.now();
    return { pushed: 0, deleted: 0, pulled: 0, conflicts: 0, pending: 0, errors: [], skipped: !this.accounts.length };
  }
  async events(from: number, to: number) {
    return this.remote.filter((r) => r.start < to && (r.end ?? r.start) >= from).map((r) => ({
      ...r, suggestion: /\bKA\b/.test(r.title) ? { type: "exam" as EventKind, subjectId: null } : null,
    }));
  }
  async adopt(r: RemoteEvent, type: EventKind, subjectId: string | null): Promise<CalendarEvent> {
    this.remote = this.remote.filter((x) => x.id !== r.id);
    return { id: crypto.randomUUID(), subjectId, type, title: r.title, start: r.start, end: r.end, note: "", source: "manual", remindBefore: 1440 };
  }
  async dismiss(r: RemoteEvent) { this.remote = this.remote.filter((x) => x.id !== r.id); }
  async history() { return []; }
  async restore(): Promise<CalendarEvent> { throw new Error("Nicht verfügbar"); }
}

export const gcal: Gcal = inTauri ? tauri : new DemoGcal();

// ---------- Hintergrund-Abgleich (Polling) ----------

const MIN = 60_000;
/** Abstand der Abfragen: 5 min bei Fokus, sonst 20 min; im Akkusparmodus verdreifacht. */
export function pollInterval(focused: boolean, saving: boolean): number {
  return (focused ? 5 : 20) * MIN * (saving ? 3 : 1);
}

export const useGcal = create<{ running: boolean; last: GSyncReport | null; rev: number; set: (p: Partial<{ running: boolean; last: GSyncReport | null }>) => void }>(
  (set) => ({ running: false, last: null, rev: 0, set: (p) => set((s) => ({ ...p, rev: s.rev + 1 })) }),
);

let inflight: Promise<GSyncReport> | null = null;
export function gcalSync(): Promise<GSyncReport> {
  inflight ??= (async () => {
    useGcal.getState().set({ running: true });
    try {
      const r = await gcal.sync();
      useGcal.getState().set({ running: false, last: r });
      if (r.pulled || r.conflicts) useSyncRev.getState().bump();
      return r;
    } catch (e) {
      useGcal.getState().set({ running: false });
      throw e;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

let nudgeTimer: number | undefined;
/** Nach lokalen Änderungen (Termin gespeichert …) kurz warten und dann übertragen. */
export function gcalNudge(delay = 4000) {
  window.clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => void gcalSync().catch(() => {}), delay);
}

/** Startet das Polling; liefert eine Aufräumfunktion. */
export function startGcalPolling(): () => void {
  let timer: number | undefined;
  let lastRun = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    const wait = pollInterval(document.hasFocus(), powerSaving());
    timer = window.setTimeout(tick, Math.max(1000, lastRun + wait - Date.now()));
  };
  const tick = async () => {
    lastRun = Date.now();
    try {
      const accs = await gcal.status();
      if (accs.some((a) => a.calendarId)) await gcalSync();
    } catch { /* Fehler stehen im Kontostatus */ }
    schedule();
  };
  // Beim Zurückkehren ins Fenster nachholen, wenn das Intervall abgelaufen ist
  const onFocus = () => { if (Date.now() - lastRun >= pollInterval(true, powerSaving())) void tick(); else schedule(); };
  const onOnline = () => void tick();
  const onLocal = () => gcalNudge();
  window.addEventListener("nf-local-change", onLocal);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", schedule);
  window.addEventListener("online", onOnline);
  const unsub = usePower.subscribe(schedule);
  timer = window.setTimeout(tick, 10_000);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", schedule);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("nf-local-change", onLocal);
    unsub();
  };
}
