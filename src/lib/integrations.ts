// Phase 6: WebUntis + Moodle BW (SPEC §8). Netzwerk und Zugangsdaten liegen komplett im Rust-Backend;
// das Frontend übergibt Passwörter nur einmalig beim Verbinden.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { api, inTauri } from "./api";

export interface UntisConfig { server: string; school: string; username: string }
export interface MoodleConfig { url: string; username: string }
export interface IntegrationStatus {
  untis: UntisConfig | null;
  moodle: MoodleConfig | null;
  untisLastSync: number | null;
  moodleLastSync: number | null;
}
export interface SyncReport { lessons: number | null; deadlines: number | null; errors: string[]; skipped: boolean }
export type LessonState = "normal" | "cancelled" | "irregular";
export interface Lesson {
  id: number; start: number; end: number;
  untisSubjectId: number | null; subjectName: string; subjectLong: string;
  rooms: string; teachers: string; state: LessonState; info: string;
  /** Über das Fach-Mapping zugeordnetes Fach. */
  subjectId: string | null;
}
export interface UntisSubject { id: number; name: string; longName: string }
export interface MoodleCourse { id: number; fullname: string; shortname: string }
export interface MoodleFile { section: string; module: string; filename: string; fileurl: string; filesize: number; modified: number }

export interface Integrations {
  status(): Promise<IntegrationStatus>;
  untisConnect(server: string, school: string, username: string, password: string): Promise<SyncReport>;
  untisDisconnect(): Promise<void>;
  moodleConnect(url: string, username: string, password: string, token: string | null): Promise<SyncReport>;
  moodleDisconnect(): Promise<void>;
  /** Anmeldung über Schul-Login (eigenes Fenster, wie die Moodle-App). */
  moodleSsoConnect(url: string): Promise<SyncReport>;
  /** 1 = Passwort, 2/3 = Schul-Login im Browser, null = unbekannt. */
  moodleLoginType(url: string): Promise<number | null>;
  sync(force: boolean): Promise<SyncReport>;
  listLessons(from: number, to: number): Promise<Lesson[]>;
  untisSubjects(): Promise<UntisSubject[]>;
  moodleCourses(): Promise<MoodleCourse[]>;
  moodleFiles(courseId: number): Promise<MoodleFile[]>;
  moodleDownload(fileurl: string): Promise<ArrayBuffer>;
}

const tauri: Integrations = {
  status: () => invoke("integration_status"),
  untisConnect: (server, school, username, password) => invoke("untis_connect", { server, school, username, password }),
  untisDisconnect: () => invoke("untis_disconnect"),
  moodleConnect: (url, username, password, token) => invoke("moodle_connect", { url, username, password, token }),
  moodleDisconnect: () => invoke("moodle_disconnect"),
  moodleSsoConnect: (url) => invoke("moodle_sso_connect", { url }),
  moodleLoginType: (url) => invoke("moodle_login_type", { url }),
  sync: (force) => invoke("integrations_sync", { force }),
  listLessons: (from, to) => invoke("list_lessons", { from, to }),
  untisSubjects: () => invoke("list_untis_subjects"),
  moodleCourses: () => invoke("moodle_courses"),
  moodleFiles: (courseId) => invoke("moodle_course_files", { courseId }),
  moodleDownload: (fileurl) => invoke<ArrayBuffer>("moodle_download", { fileurl }),
};

// ---------- Demo-Backend für Browser/Tests: erfundener Stundenplan, keine Netzwerkzugriffe ----------
const DEMO_SUBJECTS: UntisSubject[] = [
  { id: 1, name: "M", longName: "Mathematik" }, { id: 2, name: "D", longName: "Deutsch" },
  { id: 3, name: "E", longName: "Englisch" }, { id: 4, name: "PH", longName: "Physik" },
  { id: 5, name: "G", longName: "Geschichte" }, { id: 6, name: "BIO", longName: "Biologie" },
];
/** Unterrichtsbeginn je Stunde (Minuten ab Mitternacht). */
export const DEMO_SLOTS = [7 * 60 + 45, 8 * 60 + 35, 9 * 60 + 40, 10 * 60 + 30, 11 * 60 + 25, 12 * 60 + 15, 13 * 60 + 30, 14 * 60 + 15];

export class DemoIntegrations implements Integrations {
  private st: IntegrationStatus = { untis: null, moodle: null, untisLastSync: null, moodleLastSync: null };
  private lessons: Lesson[] = [];
  constructor(private now = () => Date.now()) {}

  async status() { return structuredClone(this.st); }
  async untisConnect(server: string, school: string, username: string, password: string) {
    if (!server.trim() || !school.trim() || !username.trim() || !password) throw new Error("Bitte Server, Schule, Benutzername und Passwort angeben");
    this.st.untis = { server: server.trim(), school: school.trim(), username: username.trim() };
    return this.sync(true);
  }
  async untisDisconnect() { this.st.untis = null; this.st.untisLastSync = null; this.lessons = []; }
  async moodleConnect(url: string, username: string, password: string, token: string | null) {
    if (!token && (!username.trim() || !password)) throw new Error("Bitte Benutzername und Passwort (oder ein Token) angeben");
    this.st.moodle = { url: url.trim(), username: username.trim() };
    return this.sync(true);
  }
  async moodleDisconnect() { this.st.moodle = null; this.st.moodleLastSync = null; }
  async moodleSsoConnect(url: string) {
    if (!url.trim()) throw new Error("Bitte die Moodle-Adresse angeben");
    this.st.moodle = { url: url.trim(), username: "" };
    return this.sync(true);
  }
  async moodleLoginType(url: string) { return /bw\.schule/.test(url) ? 2 : 1; }
  async sync(_force = false): Promise<SyncReport> {
    void _force;
    const rep: SyncReport = { lessons: null, deadlines: null, errors: [], skipped: false };
    const subjects = await api.listSubjects();
    if (this.st.untis) {
      const d = new Date(this.now());
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) - 7);
      this.lessons = [];
      const todayIdx = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - monday.getTime()) / 86_400_000);
      for (let day = 0; day < 42; day++) {
        const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day);
        const wd = (date.getDay() + 6) % 7;
        if (wd > 4) continue;
        DEMO_SLOTS.slice(0, 6 + (wd % 2)).forEach((min, i) => {
          const su = DEMO_SUBJECTS[(wd * 2 + i) % DEMO_SUBJECTS.length];
          const start = date.getTime() + min * 60_000;
          this.lessons.push({
            id: day * 100 + i, start, end: start + 45 * 60_000, untisSubjectId: su.id, subjectName: su.name, subjectLong: su.longName,
            rooms: `R${100 + i}`, teachers: "Mus",
            state: day === 7 && i === 2 ? "cancelled" : day === todayIdx && i === 3 ? "irregular" : day === todayIdx + 1 && i === 1 ? "cancelled" : "normal",
            info: day === 7 && i === 2 ? "Entfall" : day === todayIdx && i === 3 ? "Hub statt Mus" : "",
            subjectId: null,
          });
        });
      }
      this.st.untisLastSync = this.now();
      rep.lessons = this.lessons.length;
      // Demo: eine von WebUntis angekündigte Klassenarbeit morgen
      const evs = await api.listEvents(0, Number.MAX_SAFE_INTEGER);
      if (!evs.some((e) => e.source === "webuntis")) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() + DEMO_SLOTS[1] * 60_000;
        const su = this.lessons.find((l) => l.start === t);
        const subjectId = su ? subjects.find((s) => s.webuntisSubjectId === su.untisSubjectId)?.id ?? null : null;
        await api.saveEvent({ id: "", subjectId, type: "exam", title: "Klassenarbeit", start: t, end: t + 90 * 60_000, note: "", source: "webuntis", remindBefore: 1440 });
      }
    }
    if (this.st.moodle) {
      const existing = await api.listEvents(0, Number.MAX_SAFE_INTEGER);
      if (!existing.some((e) => e.source === "moodle")) {
        const course = subjects.find((s) => s.moodleCourseId != null);
        await api.saveEvent({
          id: "", subjectId: course?.id ?? null, type: "deadline", title: "Aufgabe 3 ist fällig",
          start: this.now() + 2 * 86_400_000, end: null, note: "Demo-Kurs", source: "moodle", remindBefore: 1440,
        });
      }
      this.st.moodleLastSync = this.now();
      rep.deadlines = 1;
    }
    rep.skipped = !this.st.untis && !this.st.moodle;
    return rep;
  }
  async listLessons(from: number, to: number) {
    const map = new Map((await api.listSubjects()).filter((s) => s.webuntisSubjectId != null).map((s) => [s.webuntisSubjectId!, s.id]));
    return this.lessons
      .filter((l) => l.start < to && l.end > from)
      .map((l) => ({ ...l, subjectId: (l.untisSubjectId != null && map.get(l.untisSubjectId)) || null }));
  }
  async untisSubjects() { return this.lessons.length ? [...DEMO_SUBJECTS] : []; }
  async moodleCourses() {
    if (!this.st.moodle) throw new Error("Moodle ist nicht verbunden");
    return [{ id: 11, fullname: "Mathematik 10b", shortname: "M10b" }, { id: 12, fullname: "Physik 10", shortname: "Ph10" }];
  }
  async moodleFiles(courseId: number) {
    if (!this.st.moodle) throw new Error("Moodle ist nicht verbunden");
    return [{ section: "Woche 1", module: "Arbeitsblatt", filename: `Arbeitsblatt-${courseId}.pdf`, fileurl: `demo://${courseId}`, filesize: 1024, modified: this.now() }];
  }
  async moodleDownload(): Promise<ArrayBuffer> { throw new Error("Im Browser-Demo gibt es keine Moodle-Dateien"); }
}

export const integrations: Integrations = inTauri ? tauri : new DemoIntegrations();

/** Zähler, den Stundenplan-/Termin-Ansichten beobachten, um nach einem Abgleich neu zu laden. */
export const useSyncRev = create<{ rev: number; bump: () => void }>((set) => ({ rev: 0, bump: () => set((s) => ({ rev: s.rev + 1 })) }));

let inflight: Promise<SyncReport> | null = null;
/** Abgleich (gedrosselt im Backend); meldet Änderungen an alle Ansichten. */
export function syncNow(force = false): Promise<SyncReport> {
  inflight ??= integrations
    .sync(force)
    .then((r) => {
      if (!r.skipped) useSyncRev.getState().bump();
      return r;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Pausen bis zu dieser Länge gelten nicht als Freistunde. */
export const MIN_FREE_MS = 25 * 60_000;

export type FreeReason = "gap" | "cancelled";
export type DaySlot =
  | { kind: "lesson"; start: number; end: number; lesson: Lesson }
  | { kind: "free"; start: number; end: number; reason: FreeReason; lesson?: Lesson }
  | { kind: "lunch"; start: number; end: number };

/** Mittagspause statt Freistunde: 40–100 min Lücke, Beginn zwischen 11:15 und 14:15 Uhr (Ortszeit). */
export function isLunchGap(start: number, end: number): boolean {
  const len = end - start, d = new Date(start), m = d.getHours() * 60 + d.getMinutes();
  return len >= 40 * 60_000 && len <= 100 * 60_000 && m >= 11 * 60 + 15 && m <= 14 * 60 + 15;
}

/**
 * Stundenplan eines Tages mit Freistunden: Lücken zwischen stattfindenden Stunden (länger als eine
 * Pause) und entfallene Stunden *zwischen* zwei stattfindenden werden als Freistunde markiert –
 * „cancelled“ (Entfall) vs. „gap“ (reguläre Lücke). Entfall am Tagesrand ist keine Freistunde,
 * sondern bleibt eine entfallene Stunde; Lücken vor der ersten/nach der letzten Stunde erscheinen nicht.
 */
export function daySlots(lessons: Lesson[]): DaySlot[] {
  const sorted = [...lessons].sort((a, b) => a.start - b.start || a.end - b.end);
  const active = sorted.filter((l) => l.state !== "cancelled");
  if (!active.length) return sorted.map((l) => ({ kind: "lesson", start: l.start, end: l.end, lesson: l }));
  const first = active[0].start, last = Math.max(...active.map((l) => l.end));
  const out: DaySlot[] = [];
  for (const l of sorted) {
    if (l.state === "cancelled") {
      const inside = l.start >= first && l.end <= last && !active.some((a) => a.start < l.end && l.start < a.end);
      out.push(inside ? { kind: "free", start: l.start, end: l.end, reason: "cancelled", lesson: l } : { kind: "lesson", start: l.start, end: l.end, lesson: l });
    } else out.push({ kind: "lesson", start: l.start, end: l.end, lesson: l });
  }
  // Reguläre Lücken: Zeiträume ohne Stunde (weder aktiv noch entfallen) zwischen erster und letzter Stunde
  let cover = first, lunch = false;
  for (const l of sorted) {
    if (l.start >= last) break;
    if (l.start - cover >= MIN_FREE_MS) {
      if (!lunch && isLunchGap(cover, l.start)) { lunch = true; out.push({ kind: "lunch", start: cover, end: l.start }); }
      else out.push({ kind: "free", start: cover, end: l.start, reason: "gap" });
    }
    cover = Math.max(cover, l.end);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Die laufende bzw. nächste Stunde des Tages. */
export function currentLesson(lessons: Lesson[], now: number): { lesson: Lesson; running: boolean } | null {
  const active = lessons.filter((l) => l.state !== "cancelled");
  const run = active.find((l) => l.start <= now && now < l.end);
  if (run) return { lesson: run, running: true };
  const d = new Date(now);
  const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const next = active.filter((l) => l.start > now && l.start < endOfDay).sort((a, b) => a.start - b.start)[0];
  return next ? { lesson: next, running: false } : null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
/** Vorschlag für das Fach-Mapping: gleicher Lang-/Kurzname oder Präfix (z. B. „Mathe“ ↔ „Mathematik“). */
export function suggestMatch<T>(subjectName: string, candidates: T[], names: (c: T) => string[]): T | null {
  const n = norm(subjectName);
  if (!n) return null;
  for (const exact of [true, false]) {
    for (const c of candidates) {
      for (const raw of names(c)) {
        const m = norm(raw);
        if (!m) continue;
        if (exact ? m === n : m.length >= 3 && n.length >= 3 && (m.startsWith(n) || n.startsWith(m))) return c;
      }
    }
  }
  return null;
}
