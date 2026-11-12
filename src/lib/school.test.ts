import { describe, expect, it } from "vitest";
import {
  MemorySchool, dueLabel, emptyHomework, fmtGrade, gradeLabel, neededGrade, overallAverage, parseGrade, subjectAverage,
  type Grade,
} from "./school";

const g = (kind: Grade["kind"], value: number, weight = 1, subjectId = "m"): Grade =>
  ({ id: Math.random().toString(), subjectId, kind, title: "", value, weight, date: 0 });

describe("Notenrechner", () => {
  it("gewichtet schriftlich/mündlich und einzelne Noten", () => {
    const gs = [g("written", 2), g("written", 3, 2), g("oral", 1)];
    const a = subjectAverage(gs, 50);
    expect(a.written).toBeCloseTo(8 / 3);
    expect(a.oral).toBe(1);
    expect(a.total).toBeCloseTo((8 / 3 + 1) / 2);
    expect(subjectAverage(gs, 100).total).toBeCloseTo(8 / 3);
    expect(subjectAverage([g("oral", 2)], 70).total).toBe(2); // nur mündlich → zählt allein
    expect(subjectAverage([], 50).total).toBeNull();
  });

  it("Gesamtschnitt: jedes Fach zählt gleich", () => {
    const gs = [g("written", 1, 1, "a"), g("written", 1, 1, "a"), g("written", 3, 1, "b")];
    expect(overallAverage(gs, { scale: "grades", writtenPct: {} })).toBe(2);
    expect(overallAverage([], { scale: "grades", writtenPct: {} })).toBeNull();
  });

  it("Zielnote für die nächste Klassenarbeit", () => {
    const gs = [g("written", 3), g("oral", 2)];
    // Ziel 2,0 bei 50/50: schriftlich (3+x)/2 *0.5 + 2*0.5 = 2 → x = 1
    expect(neededGrade(gs, 50, "grades", 2, "written")).toEqual({ kind: "value", value: 1 });
    const r = neededGrade(gs, 50, "grades", 2.5, "written");
    expect(r).toEqual({ kind: "value", value: 3 });
    expect(neededGrade(gs, 50, "grades", 1.2, "written").kind).toBe("impossible");
    expect(neededGrade(gs, 50, "grades", 4, "written").kind).toBe("safe");
    // Punkte: höher ist besser, ganze Punkte
    const ps = [g("written", 8), g("oral", 10)];
    const p = neededGrade(ps, 50, "points", 10, "written");
    expect(p).toEqual({ kind: "value", value: 12 });
    expect(neededGrade(ps, 50, "points", 15, "written").kind).toBe("impossible");
    expect(neededGrade(ps, 50, "points", 4, "written").kind).toBe("safe");
    // Keine bisherigen Noten: die eine Note ist der Schnitt
    expect(neededGrade([], 50, "grades", 2.4, "oral")).toEqual({ kind: "value", value: 2.4 });
  });

  it("Eingabe und Anzeige", () => {
    expect(parseGrade("2-", "grades")).toBe(2.3);
    expect(parseGrade("2+", "grades")).toBe(1.7);
    expect(parseGrade("2,5", "grades")).toBe(2.5);
    expect(parseGrade("7", "grades")).toBeNull();
    expect(parseGrade("13", "points")).toBe(13);
    expect(parseGrade("16", "points")).toBeNull();
    expect(parseGrade("abc", "grades")).toBeNull();
    expect(gradeLabel(2.3, "grades")).toBe("2-");
    expect(gradeLabel(1.7, "grades")).toBe("2+");
    expect(gradeLabel(3, "grades")).toBe("3");
    expect(fmtGrade(2.345, "grades")).toBe("2,35");
    expect(fmtGrade(11.25, "points")).toBe("11,3");
    expect(fmtGrade(null, "grades")).toBe("–");
  });
});

describe("Hausaufgaben", () => {
  it("Fälligkeit relativ zu heute", () => {
    const now = new Date(2026, 10, 12, 10).getTime();
    expect(dueLabel(null, now).tone).toBe("none");
    expect(dueLabel(new Date(2026, 10, 12, 18).getTime(), now)).toEqual({ text: "heute", tone: "soon" });
    expect(dueLabel(new Date(2026, 10, 13, 8).getTime(), now)).toEqual({ text: "morgen", tone: "soon" });
    expect(dueLabel(new Date(2026, 10, 10, 8).getTime(), now)).toEqual({ text: "seit 2 Tagen", tone: "overdue" });
    expect(dueLabel(new Date(2026, 10, 15, 8).getTime(), now).text).toBe("Sonntag");
  });

  it("Speicher: Reihenfolge, Erledigt, Notensystem umrechnen", async () => {
    const s = new MemorySchool();
    await s.saveHomework({ ...emptyHomework(), title: "ohne" });
    const b = await s.saveHomework({ ...emptyHomework(), title: "bald", due: 1 });
    await expect(s.saveHomework({ ...emptyHomework(), title: " " })).rejects.toThrow();
    expect((await s.listHomework(0)).map((h) => h.title)).toEqual(["bald", "ohne"]);
    await s.setHomeworkDone(b.id, true);
    expect((await s.listHomework(0)).map((h) => h.title)).toEqual(["ohne", "bald"]);
    await s.saveGrade(g("written", 2));
    await expect(s.saveGrade(g("written", 0))).rejects.toThrow();
    await s.setGradeScale("points");
    expect((await s.listGrades())[0].value).toBe(11);
  });
});
