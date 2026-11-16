// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { lessonKey, useHiddenLessons, visibleLessons } from "./hidden-lessons";
import type { Lesson } from "@/lib/integrations";

const L = (id: number | null, name: string, long = ""): Lesson => ({
  id: Math.random(), start: 0, end: 1, untisSubjectId: id, subjectName: name, subjectLong: long,
  rooms: "", teachers: "", state: "normal", info: "", subjectId: null,
});

describe("Nicht belegte Fächer", () => {
  beforeEach(() => { localStorage.clear(); useHiddenLessons.setState({ hidden: [] }); });

  it("blendet per Fach-ID bzw. Kurzname aus", () => {
    const it_ = L(7, "IT", "Italienisch"), m = L(1, "M"), x = L(null, "AG Robotik");
    expect(lessonKey(it_)).toBe("id:7");
    expect(lessonKey(x)).toBe("name:ag robotik");
    expect(visibleLessons([it_, m, x], [{ key: "id:7", label: "Italienisch" }, { key: "name:ag robotik", label: "" }])).toEqual([m]);
    expect(visibleLessons([it_, m], [])).toHaveLength(2);
  });

  it("speichert dauerhaft und lässt sich wieder einblenden", () => {
    const it_ = L(7, "IT", "Italienisch");
    useHiddenLessons.getState().hide(it_);
    useHiddenLessons.getState().hide(it_); // doppelt → einmal
    expect(useHiddenLessons.getState().hidden).toEqual([{ key: "id:7", label: "Italienisch" }]);
    expect(JSON.parse(localStorage.getItem("noteforge-untis-hidden")!)).toHaveLength(1);
    useHiddenLessons.getState().show("id:7");
    expect(useHiddenLessons.getState().hidden).toEqual([]);
    expect(JSON.parse(localStorage.getItem("noteforge-untis-hidden")!)).toEqual([]);
  });
});
