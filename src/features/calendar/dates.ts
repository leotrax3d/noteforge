// Reine Datumslogik für den Kalender (lokale Zeit, Woche beginnt Montag).
import type { CalendarEvent, EventKind } from "@/lib/types";

export const DAY = 86_400_000;
export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export const KIND_LABEL: Record<EventKind, string> = {
  exam: "Klassenarbeit", test: "Test", deadline: "Abgabe", other: "Sonstiges",
};
export const KIND_SHORT: Record<EventKind, string> = { exam: "KA", test: "Test", deadline: "Abgabe", other: "" };

export const REMINDERS: { value: number | null; label: string }[] = [
  { value: null, label: "Keine Erinnerung" },
  { value: 0, label: "Zum Beginn" },
  { value: 15, label: "15 Minuten vorher" },
  { value: 60, label: "1 Stunde vorher" },
  { value: 1440, label: "1 Tag vorher" },
  { value: 2 * 1440, label: "2 Tage vorher" },
  { value: 7 * 1440, label: "1 Woche vorher" },
];
/** Vorschlag je Typ: Klassenarbeiten früh, Abgaben am Vortag. */
export const DEFAULT_REMINDER: Record<EventKind, number | null> = { exam: 7 * 1440, test: 2 * 1440, deadline: 1440, other: null };

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function startOfWeek(d: Date) {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
}

/** 6×7-Raster für die Monatsansicht. */
export function monthGrid(year: number, month: number): Date[] {
  const first = startOfWeek(new Date(year, month, 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** ISO-8601-Kalenderwoche. */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / DAY + 1) / 7);
}

/** Termine, die den Tag `day` berühren. */
export function eventsOn(events: CalendarEvent[], day: Date) {
  const a = startOfDay(day).getTime(), b = addDays(startOfDay(day), 1).getTime();
  return events.filter((e) => e.start < b && (e.end ?? e.start) >= a);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const toDateInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const toTimeInput = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function fromInputs(date: string, time: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = (time || "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}
export const fmtTime = (t: number) => toTimeInput(t);
export function fmtDate(t: number, withWeekday = true) {
  const d = new Date(t);
  return `${withWeekday ? WEEKDAYS[(d.getDay() + 6) % 7] + ", " : ""}${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

/** Countdown in Kalendertagen: „heute“, „morgen“, „in 5 Tagen“, „in 3 Wochen“. */
export function countdown(start: number, now: number) {
  const days = Math.round((startOfDay(new Date(start)).getTime() - startOfDay(new Date(now)).getTime()) / DAY);
  if (days < 0) return { days, label: "vorbei" };
  if (days === 0) {
    const h = Math.floor((start - now) / 3_600_000);
    return { days, label: start <= now ? "läuft" : h >= 1 ? `heute, in ${h} Std.` : `heute, in ${Math.max(1, Math.ceil((start - now) / 60_000))} Min.` };
  }
  if (days === 1) return { days, label: "morgen" };
  if (days < 21) return { days, label: `in ${days} Tagen` };
  return { days, label: `in ${Math.round(days / 7)} Wochen` };
}

/** Ganztägig = 00:00 ohne Ende (Abgaben, Klassenarbeiten ohne Uhrzeit). */
export const isAllDay = (e: CalendarEvent) => {
  const d = new Date(e.start);
  return d.getHours() === 0 && d.getMinutes() === 0 && e.end == null;
};
