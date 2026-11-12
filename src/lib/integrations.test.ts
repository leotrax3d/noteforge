import { describe, expect, it } from "vitest";
import { DemoIntegrations, currentLesson, suggestMatch, type Lesson } from "./integrations";

const L = (id: number, start: number, end: number, state: Lesson["state"] = "normal"): Lesson => ({
  id, start, end, state, untisSubjectId: id, subjectName: "", subjectLong: "", rooms: "", teachers: "", info: "", subjectId: null,
});

describe("Integrationen", () => {
  it("findet die laufende oder nächste Stunde, ohne Ausfälle", () => {
    const base = new Date(2026, 10, 12, 8, 0).getTime();
    const ls = [L(1, base - 15 * 60e3, base + 30 * 60e3, "cancelled"), L(2, base + 3600e3, base + 2 * 3600e3)];
    expect(currentLesson(ls, base)).toEqual({ lesson: ls[1], running: false });
    expect(currentLesson(ls, base + 3700e3)).toEqual({ lesson: ls[1], running: true });
    expect(currentLesson(ls, base + 16 * 3600e3)).toBeNull();
  });

  it("schlägt Zuordnungen nach Namen vor", () => {
    const c = [{ n: ["M", "Mathematik"] }, { n: ["D", "Deutsch"] }, { n: ["PH", "Physik"] }];
    expect(suggestMatch("Mathe", c, (x) => x.n)).toBe(c[0]);
    expect(suggestMatch("Physik", c, (x) => x.n)).toBe(c[2]);
    expect(suggestMatch("Kunst", c, (x) => x.n)).toBeNull();
  });

  it("Demo verbindet und liefert einen Stundenplan", async () => {
    const d = new DemoIntegrations(() => new Date(2026, 10, 12, 9, 0).getTime());
    await expect(d.untisConnect("", "x", "u", "p")).rejects.toThrow();
    const rep = await d.untisConnect("demo.webuntis.com", "Schule", "u", "p");
    expect(rep.lessons).toBeGreaterThan(50);
    const day = await d.listLessons(new Date(2026, 10, 12).getTime(), new Date(2026, 10, 13).getTime());
    expect(day.length).toBe(7);
    expect((await d.status()).untis?.school).toBe("Schule");
  });
});
