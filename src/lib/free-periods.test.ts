import { describe, expect, it } from "vitest";
import { daySlots, type Lesson } from "./integrations";

const H = 3_600_000;
const L = (id: number, h0: number, h1: number, state: Lesson["state"] = "normal"): Lesson => ({
  id, start: h0 * H, end: h1 * H, untisSubjectId: null, subjectName: "M", subjectLong: "Mathe",
  rooms: "", teachers: "", state, info: "", subjectId: null,
});

describe("Freistunden", () => {
  it("markiert Lücken zwischen Stunden", () => {
    const s = daySlots([L(1, 8, 9), L(2, 10, 11)]);
    expect(s.map((x) => x.kind)).toEqual(["lesson", "free", "lesson"]);
    expect(s[1]).toMatchObject({ reason: "gap", start: 9 * H, end: 10 * H });
  });
  it("unterscheidet Entfall von Lücke", () => {
    const s = daySlots([L(1, 8, 9), L(2, 9, 10, "cancelled"), L(3, 10, 11)]);
    expect(s[1]).toMatchObject({ kind: "free", reason: "cancelled" });
    expect(s.filter((x) => x.kind === "free")).toHaveLength(1);
  });
  it("keine Freistunde am Tagesrand", () => {
    const s = daySlots([L(1, 8, 9, "cancelled"), L(2, 9, 10), L(3, 10, 11, "cancelled")]);
    expect(s.every((x) => x.kind === "lesson")).toBe(true);
  });
  it("kurze Pausen sind keine Freistunden", () => {
    expect(daySlots([L(1, 8, 8.75), L(2, 9, 10)]).some((x) => x.kind === "free")).toBe(false);
  });
});
