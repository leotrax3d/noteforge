import { describe, expect, it } from "vitest";
import { placeText, DEFAULT_METRICS } from "./text-snap";
import { MM, type PageSetup } from "./layout";

const setup = (background: PageSetup["background"], mm = 8): PageSetup =>
  ({ mode: "infinite", orientation: "portrait", background, bgSpacingMm: mm, pageColor: "#fff" });

describe("text-snap", () => {
  it("liniert: Grundlinie liegt auf der nächsten Linie", () => {
    const step = 8 * MM;
    const p = placeText(setup("lines"), { x: 50, y: step * 3 - 5 });
    const m = DEFAULT_METRICS;
    const baseline = p.y! + (p.lineHeight! - (m.ascent + m.descent) * p.size!) / 2 + m.ascent * p.size!;
    expect(baseline).toBeCloseTo(step * 3);
    expect(p.lineHeight).toBeCloseTo(step);
    expect(p.x).toBe(50);
  });
  it("kariert: linker Rand auf Rasterspalte", () => {
    const step = 5 * MM;
    const p = placeText(setup("grid", 5), { x: step * 2 + 3, y: 40 });
    expect(p.x).toBeCloseTo(step * 2);
    expect(p.padX).toBe(0);
  });
  it("leer oder Alt: kein Einrasten", () => {
    expect(placeText(setup("blank"), { x: 10, y: 50 })).toEqual({ x: 10, y: 34 });
    expect(placeText(setup("lines"), { x: 10, y: 50 }, true).size).toBeUndefined();
  });
});
