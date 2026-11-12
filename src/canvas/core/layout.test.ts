import { describe, expect, it } from "vitest";
import { A4_MARGIN, a4CamBounds, a4Size, rubber } from "./layout";

describe("A4-Grenzen", () => {
  it("zentriert, wenn die Sicht breiter als die Seite ist", () => {
    const { w } = a4Size("portrait");
    const b = a4CamBounds("portrait", 2, w * 2, 600);
    expect(b.minX).toBeCloseTo(b.maxX);
    expect(b.minX).toBeCloseTo(-w / 2);
  });
  it("begrenzt oben auf die erste Seite", () => {
    expect(a4CamBounds("portrait", 1, 300, 300).minY).toBe(-A4_MARGIN);
  });
  it("Gummiband bremst weich", () => {
    expect(rubber(5, 0, 10, 100)).toBe(5);
    const a = rubber(-50, 0, 10, 100), b = rubber(-500, 0, 10, 100);
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-50);
    expect(b).toBeGreaterThan(-100);
  });
});
