// WebUntis im Alltag (SPEC §8.1): aktive Stunde, Pausen, Hausaufgaben-/Prüfungshinweise und die
// Zähler für Ausfälle/Freistunden/Vertretungen. Reine Funktionen, alle Zeiten als Netzzeit übergeben.
import { daySlots, isLunchGap, MIN_FREE_MS, type Lesson } from "./integrations";
import type { Homework } from "./school";
import type { CalendarEvent } from "./types";

const DAY = 86_400_000;
const dayStart = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const nextDay = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
const sameDay = (a: number, b: number) => dayStart(a) === dayStart(b);
const active = (ls: Lesson[]) => ls.filter((l) => l.state !== "cancelled").sort((a, b) => a.start - b.start);

/** Laufende (nicht entfallene) Stunde. */
export function runningLesson(lessons: Lesson[], now: number): Lesson | null {
  return active(lessons).find((l) => l.start <= now && now < l.end) ?? null;
}

export type BreakKind = "short5" | "short10" | "big" | "lunch";
export const BREAK_LABEL: Record<BreakKind, string> = {
  short5: "5-Minuten-Pause", short10: "10-Minuten-Pause", big: "Große Pause", lunch: "Mittagspause",
};
export interface BreakInfo { kind: BreakKind; start: number; end: number; minutes: number; next: Lesson }

/** Pause zwischen zwei stattfindenden Stunden desselben Tages; Freistunden zählen nicht als Pause. */
export function currentBreak(lessons: Lesson[], now: number): BreakInfo | null {
  const ls = active(lessons).filter((l) => sameDay(l.start, now));
  if (ls.some((l) => l.start <= now && now < l.end)) return null;
  const prevEnd = Math.max(-Infinity, ...ls.filter((l) => l.end <= now).map((l) => l.end));
  const next = ls.find((l) => l.start > now);
  if (!next || !Number.isFinite(prevEnd)) return null;
  const len = next.start - prevEnd, minutes = Math.round(len / 60_000);
  const lunch = isLunchGap(prevEnd, next.start);
  if (len >= MIN_FREE_MS && !lunch) return null; // Freistunde
  const kind: BreakKind = lunch ? "lunch" : minutes <= 7 ? "short5" : minutes <= 14 ? "short10" : "big";
  return { kind, start: prevEnd, end: next.start, minutes, next };
}

/** Nächste stattfindende Stunde eines Fachs (laufende zählt mit). */
export function nextLessonOf(lessons: Lesson[], subjectId: string, now: number): Lesson | null {
  return active(lessons).find((l) => l.subjectId === subjectId && l.end > now) ?? null;
}

export interface HomeworkHint {
  /** Offen und in der nächsten Stunde des Fachs fällig */
  dueNext: boolean;
  /** Am Fälligkeitstag entfallen alle Stunden des Fachs */
  cancelled: boolean;
}

export function homeworkHint(h: Homework, lessons: Lesson[], now: number): HomeworkHint {
  const res: HomeworkHint = { dueNext: false, cancelled: false };
  if (!h.subjectId || h.due == null) return res;
  const onDue = lessons.filter((l) => l.subjectId === h.subjectId && sameDay(l.start, h.due!));
  res.cancelled = onDue.length > 0 && onDue.every((l) => l.state === "cancelled");
  if (h.doneAt == null) {
    const next = nextLessonOf(lessons, h.subjectId, now);
    res.dueNext = !!next && sameDay(next.start, h.due) && h.due + DAY > now;
  }
  return res;
}

/** Arbeiten/Tests, die morgen stattfinden. */
export function examsTomorrow(events: CalendarEvent[], now: number): CalendarEvent[] {
  const a = nextDay(now), b = nextDay(a);
  return events.filter((e) => (e.type === "exam" || e.type === "test") && e.start >= a && e.start < b);
}

export interface DotCounts { cancelled: number; free: number; substitution: number }

/** Ausfälle (rot), Freistunden (grün), Vertretungen (gelb) für heute und morgen. */
export function dotCounts(lessons: Lesson[], now: number): DotCounts {
  const a = dayStart(now), b = nextDay(nextDay(now));
  const ls = lessons.filter((l) => l.start >= a && l.start < b);
  const out: DotCounts = { cancelled: 0, free: 0, substitution: 0 };
  for (const d of [a, nextDay(now)]) {
    const day = ls.filter((l) => sameDay(l.start, d));
    out.free += daySlots(day).filter((x) => x.kind === "free").length;
  }
  out.cancelled = ls.filter((l) => l.state === "cancelled").length;
  out.substitution = ls.filter((l) => l.state === "irregular").length;
  return out;
}
