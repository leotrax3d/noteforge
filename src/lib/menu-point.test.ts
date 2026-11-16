// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clampToViewport, contextPoint, setLastPointer } from "./menu-point";

afterEach(() => setLastPointer(null));

describe("contextPoint", () => {
  it("nimmt die Mausposition", () => {
    expect(contextPoint({ clientX: 705, clientY: 455 })).toEqual({ x: 705, y: 455 });
  });
  it("Ereignis ohne Koordinaten (Menütaste/Stift): letzte Zeigerposition statt linker Rand", () => {
    setLastPointer({ x: 640, y: 300, t: 1000 });
    expect(contextPoint({ clientX: 0, clientY: 0 }, null, 1200)).toEqual({ x: 640, y: 300 });
  });
  it("ohne frische Zeigerposition: am Element statt bei 0,0", () => {
    setLastPointer({ x: 640, y: 300, t: 0 });
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 400, top: 200, right: 600, bottom: 260, width: 200, height: 60, x: 400, y: 200, toJSON() {} });
    expect(contextPoint({ clientX: 0, clientY: 0 }, el, 10_000)).toEqual({ x: 408, y: 208 });
  });
  it("bleibt im sichtbaren Bereich", () => {
    expect(clampToViewport({ x: -20, y: 5000 }, 1280, 800)).toEqual({ x: 4, y: 796 });
  });
});

import { clampCenter } from "@/features/canvas/SelectionMenu";
describe("Auswahlmenü am Rand", () => {
  it("bleibt vollständig im Editor", () => {
    expect(clampCenter(10, 300, 1000)).toBe(158);
    expect(clampCenter(990, 300, 1000)).toBe(842);
    expect(clampCenter(500, 300, 1000)).toBe(500);
    expect(clampCenter(100, 900, 600)).toBe(300);
  });
});
