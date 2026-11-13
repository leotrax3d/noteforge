// Phase 10: Hausaufgaben-Liste und Notenrechner. Persistenz über Tauri-Commands (Rust: db/school.rs),
// außerhalb von Tauri ein In-Memory-Ersatz. Die Rechenlogik ist rein und getestet (school.test.ts).
import { invoke } from "@tauri-apps/api/core";
import { inTauri, notifyLocalChange } from "./api";

export interface Homework {
  id: string;
  subjectId: string | null;
  title: string;
  note: string;
  /** Fälligkeit (ms), null = ohne Termin */
  due: number | null;
  doneAt: number | null;
  source: "manual" | "moodle" | "webuntis";
  url: string;
  createdAt: number;
  updatedAt: number;
}
export type GradeKind = "written" | "oral";
export type GradeScale = "grades" | "points";
export interface Grade { id: string; subjectId: string; kind: GradeKind; title: string; value: number; weight: number; date: number }
export interface GradeConfig { scale: GradeScale; writtenPct: Record<string, number> }
/** Geschriebene Arbeit/Test, Note fehlt noch („Ausstehend“). Note eintragen = saveGrade mit derselben ID. */
export interface PendingGrade { id: string; subjectId: string; kind: GradeKind; title: string; date: number }

export interface SchoolBackend {
  listHomework(doneSince: number): Promise<Homework[]>;
  saveHomework(h: Homework): Promise<Homework>;
  setHomeworkDone(id: string, done: boolean): Promise<Homework>;
  deleteHomework(id: string): Promise<void>;
  listGrades(): Promise<Grade[]>;
  /** Legt dabei fehlende Einträge für inzwischen geschriebene Arbeiten an (auch offline). */
  listPendingGrades(): Promise<PendingGrade[]>;
  saveGrade(g: Grade): Promise<Grade>;
  deleteGrade(id: string): Promise<void>;
  gradeConfig(): Promise<GradeConfig>;
  setSubjectWeight(subjectId: string, writtenPct: number): Promise<void>;
  setGradeScale(scale: GradeScale): Promise<void>;
}

const tauri: SchoolBackend = {
  listHomework: (doneSince) => invoke("list_homework", { doneSince }),
  saveHomework: (homework) => invoke<Homework>("save_homework", { homework }).finally(notifyLocalChange),
  setHomeworkDone: (id, done) => invoke<Homework>("set_homework_done", { id, done }).finally(notifyLocalChange),
  deleteHomework: (id) => invoke<void>("delete_homework", { id }).finally(notifyLocalChange),
  listGrades: () => invoke("list_grades"),
  listPendingGrades: () => invoke("list_pending_grades"),
  saveGrade: (grade) => invoke("save_grade", { grade }),
  deleteGrade: (id) => invoke("delete_grade", { id }),
  gradeConfig: () => invoke("grade_config"),
  setSubjectWeight: (subjectId, writtenPct) => invoke("set_subject_weight", { subjectId, writtenPct }),
  setGradeScale: (scale) => invoke("set_grade_scale", { scale }),
};

// ---------- Rechenlogik ----------

export const SCALE: Record<GradeScale, { min: number; max: number; best: number; label: string; unit: string }> = {
  grades: { min: 1, max: 6, best: 1, label: "Noten 1–6", unit: "Note" },
  points: { min: 0, max: 15, best: 15, label: "Punkte 0–15 (Oberstufe)", unit: "Punkte" },
};
export const DEFAULT_WRITTEN_PCT = 50;

/** Gewichteter Schnitt, null bei leerer Liste. */
export function weightedMean(gs: Pick<Grade, "value" | "weight">[]): number | null {
  let s = 0, w = 0;
  for (const g of gs) { s += g.value * g.weight; w += g.weight; }
  return w > 0 ? s / w : null;
}

export interface SubjectAverage { written: number | null; oral: number | null; total: number | null; count: number }

/** Fachschnitt: schriftlich und mündlich getrennt gemittelt, dann nach Anteil gewichtet.
 *  Fehlt ein Bereich, zählt der andere allein. */
export function subjectAverage(gs: Pick<Grade, "kind" | "value" | "weight">[], writtenPct = DEFAULT_WRITTEN_PCT): SubjectAverage {
  const written = weightedMean(gs.filter((g) => g.kind === "written"));
  const oral = weightedMean(gs.filter((g) => g.kind === "oral"));
  const p = Math.min(100, Math.max(0, writtenPct)) / 100;
  const total = written != null && oral != null ? written * p + oral * (1 - p) : written ?? oral;
  return { written, oral, total, count: gs.length };
}

/** Gesamtschnitt über alle Fächer mit Noten (jedes Fach zählt gleich). */
export function overallAverage(grades: Grade[], cfg: GradeConfig): number | null {
  const by = groupBySubject(grades);
  const avgs = [...by].map(([id, gs]) => subjectAverage(gs, cfg.writtenPct[id] ?? DEFAULT_WRITTEN_PCT).total).filter((x): x is number => x != null);
  return avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
}

export function groupBySubject(grades: Grade[]): Map<string, Grade[]> {
  const m = new Map<string, Grade[]>();
  for (const g of grades) {
    const l = m.get(g.subjectId);
    if (l) l.push(g); else m.set(g.subjectId, [g]);
  }
  return m;
}

export type Needed =
  | { kind: "value"; value: number }
  /** Ziel ist mit jeder Note sicher erreicht */
  | { kind: "safe" }
  /** Ziel ist mit dieser einen Note nicht mehr erreichbar */
  | { kind: "impossible"; best: number };

/** Welche Note braucht es in der nächsten Leistung (Art, Gewicht), damit der Fachschnitt das Ziel erreicht?
 *  Der Schnitt ist linear in der neuen Note → zwei Auswertungen genügen. */
export function neededGrade(
  gs: Pick<Grade, "kind" | "value" | "weight">[], writtenPct: number, scale: GradeScale,
  target: number, kind: GradeKind, weight = 1,
): Needed {
  const sc = SCALE[scale];
  const at = (x: number) => subjectAverage([...gs, { kind, value: x, weight }], writtenPct).total!;
  const f0 = at(0), f1 = at(1);
  const x = (target - f0) / (f1 - f0);
  const higherBetter = scale === "points";
  // Bei Noten muss die neue Note ≤ x sein, bei Punkten ≥ x.
  const worst = higherBetter ? sc.min : sc.max;
  const best = higherBetter ? sc.max : sc.min;
  const eps = 1e-9;
  if (higherBetter ? x <= worst + eps : x >= worst - eps) return { kind: "safe" };
  if (higherBetter ? x > best + eps : x < best - eps) return { kind: "impossible", best: at(best) };
  // Auf darstellbare Stufe runden, ohne das Ziel zu verfehlen
  const v = higherBetter ? Math.ceil(x - eps) : Math.floor(x * 100 + eps) / 100;
  return { kind: "value", value: v };
}

const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Anzeige: Noten mit zwei Nachkommastellen, Punkte mit einer. */
export function fmtGrade(v: number | null, scale: GradeScale): string {
  if (v == null) return "–";
  return scale === "points" ? nf1.format(v) : nf2.format(v);
}

/** Einzelne Note mit Tendenz: 1,7 → „2+“, 2,3 → „2-“ (nur Notenskala). */
export function gradeLabel(v: number, scale: GradeScale): string {
  if (scale === "points") return `${nf1.format(v)} P.`;
  const r = Math.round(v);
  const d = v - r;
  if (Math.abs(d) < 0.15) return String(r);
  if (d <= -0.15 && d > -0.5) return `${r}+`;
  if (d >= 0.15 && d < 0.5) return `${r}-`;
  return nf2.format(v);
}

/** Ampel für Schnitt (gut / mittel / kritisch). */
export function gradeTone(v: number | null, scale: GradeScale): "good" | "mid" | "bad" | null {
  if (v == null) return null;
  const n = scale === "points" ? (17 - v) / 3 : v;
  return n <= 2.5 ? "good" : n <= 4 ? "mid" : "bad";
}

/** Eingabe „2-“, „2+“, „2,5“, „11“ → Zahl in der aktiven Skala. */
export function parseGrade(input: string, scale: GradeScale): number | null {
  const s = input.trim().replace(",", ".");
  if (!s) return null;
  let v: number;
  const m = /^([1-6])\s*([+-])$/.exec(s);
  if (scale === "grades" && m) v = Number(m[1]) + (m[2] === "+" ? -0.3 : 0.3);
  else if (/^\d+(\.\d+)?$/.test(s)) v = Number(s);
  else return null;
  v = Math.round(v * 100) / 100;
  const sc = SCALE[scale];
  return v >= sc.min && v <= sc.max ? v : null;
}

/** Hausaufgaben-Fälligkeit als kurzer Text relativ zu heute. */
export function dueLabel(due: number | null, now: number): { text: string; tone: "overdue" | "soon" | "later" | "none" } {
  if (due == null) return { text: "ohne Termin", tone: "none" };
  const day = (t: number) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000; };
  const diff = day(due) - day(now);
  if (due < now && diff < 0) return { text: diff === -1 ? "seit gestern" : `seit ${-diff} Tagen`, tone: "overdue" };
  if (diff <= 0) return { text: "heute", tone: due < now ? "overdue" : "soon" };
  if (diff === 1) return { text: "morgen", tone: "soon" };
  if (diff < 7) return { text: new Date(due).toLocaleDateString("de-DE", { weekday: "long" }), tone: "later" };
  return { text: new Date(due).toLocaleDateString("de-DE", { day: "numeric", month: "short" }), tone: "later" };
}

// ---------- Demo-/Test-Backend ----------

export class MemorySchool implements SchoolBackend {
  hw: Homework[] = [];
  grades: Grade[] = [];
  cfg: GradeConfig = { scale: "grades", writtenPct: {} };
  private n = 0;
  private id = () => `m${++this.n}${Math.random().toString(36).slice(2, 6)}`;

  async listHomework(doneSince: number) {
    return this.hw
      .filter((h) => h.doneAt == null || h.doneAt >= doneSince)
      .sort((a, b) => Number(a.doneAt != null) - Number(b.doneAt != null) || (a.due ?? Infinity) - (b.due ?? Infinity) || a.createdAt - b.createdAt)
      .map((h) => ({ ...h }));
  }
  async saveHomework(h: Homework) {
    if (!h.title.trim()) throw new Error("Ungültig: Titel darf nicht leer sein");
    const now = Date.now();
    const i = this.hw.findIndex((x) => x.id === h.id);
    if (i < 0) {
      const n = { ...h, id: this.id(), title: h.title.trim(), source: "manual" as const, createdAt: now, updatedAt: now };
      this.hw.push(n);
      return { ...n };
    }
    const old = this.hw[i];
    const n = old.source === "moodle"
      ? { ...old, subjectId: h.subjectId, note: h.note, doneAt: h.doneAt, updatedAt: now }
      : { ...old, ...h, title: h.title.trim(), source: old.source, updatedAt: now };
    this.hw[i] = n;
    return { ...n };
  }
  async setHomeworkDone(id: string, done: boolean) {
    const h = this.hw.find((x) => x.id === id);
    if (!h) throw new Error(`Nicht gefunden: Hausaufgabe ${id}`);
    h.doneAt = done ? Date.now() : null;
    return { ...h };
  }
  async deleteHomework(id: string) { this.hw = this.hw.filter((x) => x.id !== id); }
  private skipped = new Set<string>();
  async listPendingGrades(): Promise<PendingGrade[]> {
    const { api } = await import("./api");
    const now = Date.now();
    const evs = await api.listEvents(now - 14 * 86_400_000, now);
    return evs
      .filter((e) => (e.type === "exam" || e.type === "test") && e.subjectId && (e.end ?? e.start + 2_700_000) <= now)
      .map((e) => ({ id: `pending:event:${e.id}`, subjectId: e.subjectId!, kind: "written" as const, title: e.title, date: e.start }))
      .filter((p) => !this.skipped.has(p.id) && !this.grades.some((g) => g.id === p.id));
  }
  async listGrades() { return [...this.grades].sort((a, b) => a.date - b.date).map((g) => ({ ...g })); }
  async saveGrade(g: Grade) {
    const sc = SCALE[this.cfg.scale];
    if (!(g.value >= sc.min && g.value <= sc.max)) throw new Error(`Ungültig: Wert außerhalb ${sc.label}`);
    if (!(g.weight > 0 && g.weight <= 10)) throw new Error("Ungültig: Gewicht muss größer als 0 und höchstens 10 sein");
    const n = { ...g, id: g.id || this.id(), title: g.title.trim() };
    this.grades = [...this.grades.filter((x) => x.id !== n.id), n];
    return { ...n };
  }
  async deleteGrade(id: string) {
    if (id.startsWith("pending:")) this.skipped.add(id);
    this.grades = this.grades.filter((x) => x.id !== id);
  }
  async gradeConfig() { return structuredClone(this.cfg); }
  async setSubjectWeight(subjectId: string, writtenPct: number) { this.cfg.writtenPct[subjectId] = writtenPct; }
  async setGradeScale(scale: GradeScale) {
    if (scale === this.cfg.scale) return;
    for (const g of this.grades) {
      g.value = scale === "points"
        ? Math.max(0, Math.min(15, Math.round(17 - 3 * g.value)))
        : Math.max(1, Math.min(6, Math.round(((17 - g.value) / 3) * 100) / 100));
    }
    this.cfg.scale = scale;
  }
}

export const school: SchoolBackend = inTauri ? tauri : new MemorySchool();

export const emptyHomework = (subjectId: string | null = null): Homework => ({
  id: "", subjectId, title: "", note: "", due: null, doneAt: null, source: "manual", url: "", createdAt: 0, updatedAt: 0,
});
