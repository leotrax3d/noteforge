import { describe, expect, it } from "vitest";
import { dayTitle, stepDay } from "./TimetableRail";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe("Stundenplan-Leiste: Tagesnavigation", () => {
  it("springt über das Wochenende, auch zurück in die Vergangenheit", () => {
    expect(stepDay(d(2026, 11, 13), 1)).toBe(d(2026, 11, 16)); // Fr → Mo
    expect(stepDay(d(2026, 11, 16), -1)).toBe(d(2026, 11, 13)); // Mo → Fr
    expect(stepDay(d(2026, 11, 17), -1)).toBe(d(2026, 11, 16));
  });
  it("beschriftet relativ zu heute", () => {
    const today = d(2026, 11, 16);
    expect(dayTitle(today, today)).toMatch(/^Heute · /);
    expect(dayTitle(d(2026, 11, 15), today)).toMatch(/^Gestern · /);
    expect(dayTitle(d(2026, 11, 17), today)).toMatch(/^Morgen · /);
    expect(dayTitle(d(2026, 11, 10), today)).not.toMatch(/Heute|Gestern|Morgen/);
  });
});
