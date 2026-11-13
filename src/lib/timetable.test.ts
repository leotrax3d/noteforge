import { describe, expect, it } from "vitest";
import { daySlots, type Lesson } from "./integrations";
import { currentBreak, dotCounts, examsTomorrow, homeworkHint, runningLesson } from "./timetable";
import { emptyHomework } from "./school";
import type { CalendarEvent } from "./types";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, 16 + d, h, m).getTime(); // Mo 16.11.2026
const L = (id: number, d: number, h0: number, m0: number, min: number, sid: string | null = "m", state: Lesson["state"] = "normal"): Lesson => ({
  id, start: at(d, h0, m0), end: at(d, h0, m0) + min * 60_000, untisSubjectId: 1, subjectName: "M", subjectLong: "Mathe",
  rooms: "", teachers: "", state, info: "", subjectId: sid,
});

describe("Pausen", () => {
  const day = [L(1, 0, 7, 45, 45), L(2, 0, 8, 35, 45, "d"), L(3, 0, 9, 30, 45), L(4, 0, 10, 35, 45), L(5, 0, 11, 25, 45), L(6, 0, 13, 10, 45)];
  it("erkennt Art der Pause", () => {
    expect(currentBreak(day, at(0, 8, 32))?.kind).toBe("short5");
    expect(currentBreak(day, at(0, 9, 20))?.kind).toBe("short10");
    expect(currentBreak(day, at(0, 10, 20))).toMatchObject({ kind: "big", minutes: 20 });
    expect(currentBreak(day, at(0, 12, 30))).toMatchObject({ kind: "lunch", minutes: 60 });
    expect(currentBreak([L(1, 0, 8, 0, 45), L(2, 0, 8, 50, 45)], at(0, 8, 47))?.kind).toBe("short5");
    expect(currentBreak(day, at(0, 8, 0))).toBeNull();
    expect(currentBreak(day, at(0, 7, 0)), "vor Schulbeginn").toBeNull();
  });
  it("Mittagspause ist keine Freistunde, Lücke am Vormittag schon", () => {
    expect(daySlots(day).map((x) => x.kind)).toContain("lunch");
    expect(daySlots(day).some((x) => x.kind === "free")).toBe(false);
    const gap = [L(1, 0, 8, 0, 45), L(2, 0, 9, 45, 45)];
    expect(daySlots(gap).some((x) => x.kind === "free")).toBe(true);
    expect(currentBreak(gap, at(0, 9, 0))).toBeNull();
  });
  it("laufende Stunde ignoriert Entfall", () => {
    expect(runningLesson([L(1, 0, 8, 0, 45, "m", "cancelled")], at(0, 8, 10))).toBeNull();
    expect(runningLesson([L(1, 0, 8, 0, 45)], at(0, 8, 10))?.id).toBe(1);
  });
});

describe("Hausaufgaben-Hinweise", () => {
  const ls = [L(1, 1, 8, 0, 45), L(2, 3, 8, 0, 45, "m", "cancelled"), L(3, 4, 8, 0, 45)];
  const hw = (due: number, done = false) => ({ ...emptyHomework("m"), id: "h", due, doneAt: done ? 1 : null });
  it("fällig in der nächsten Stunde", () => {
    expect(homeworkHint(hw(at(1, 0)), ls, at(0, 12)).dueNext).toBe(true);
    expect(homeworkHint(hw(at(1, 0), true), ls, at(0, 12)).dueNext).toBe(false);
    expect(homeworkHint(hw(at(4, 0)), ls, at(0, 12)).dueNext, "erst übernächste Stunde").toBe(false);
    expect(homeworkHint(hw(at(4, 0)), ls, at(2, 12)).dueNext, "Entfall übersprungen").toBe(true);
  });
  it("kennzeichnet entfallene Stunde am Fälligkeitstag", () => {
    expect(homeworkHint(hw(at(3, 0)), ls, at(0, 12)).cancelled).toBe(true);
    expect(homeworkHint(hw(at(1, 0)), ls, at(0, 12)).cancelled).toBe(false);
  });
});

describe("Prüfungen und Dots", () => {
  it("Arbeit morgen", () => {
    const ev = (start: number, type: CalendarEvent["type"]): CalendarEvent => ({ id: String(start), subjectId: null, type, title: "", start, end: null, note: "", source: "webuntis", remindBefore: null });
    expect(examsTomorrow([ev(at(1, 8), "exam"), ev(at(1, 9), "other"), ev(at(2, 8), "test")], at(0, 20))).toHaveLength(1);
  });
  it("zählt heute und morgen", () => {
    const ls = [
      L(1, 0, 8, 0, 45), L(2, 0, 9, 0, 45, "m", "cancelled"), L(3, 0, 10, 0, 45, "m", "irregular"),
      L(4, 1, 8, 0, 45), L(5, 1, 10, 0, 45), L(6, 2, 8, 0, 45, "m", "cancelled"),
    ];
    expect(dotCounts(ls, at(0, 7))).toEqual({ cancelled: 1, free: 2, substitution: 1 });
  });
});
