import { describe, expect, it } from "vitest";
import { PressureSmoother, clampPressureEdges, isDot, minDistWorld, tuneForWidth } from "./ink-filter";
import { PSTRIDE } from "./model";

const pts = (arr: [number, number, number][]) => {
  const d = new Float32Array(arr.length * PSTRIDE);
  arr.forEach(([x, y, p], i) => { d[i * PSTRIDE] = x; d[i * PSTRIDE + 1] = y; d[i * PSTRIDE + 2] = p; });
  return d;
};

describe("ink-filter", () => {
  it("Mindestabstand hängt vom Zoom ab", () => {
    expect(minDistWorld(1)).toBeCloseTo(0.3);
    expect(minDistWorld(4)).toBeCloseTo(0.075);
  });
  it("glättet Druck", () => {
    const s = new PressureSmoother();
    s.push(0.5); s.push(0.5); s.push(0.5);
    expect(s.push(1)).toBeCloseTo(0.625);
  });
  it("kappt Druckspitzen an Anfang und Ende", () => {
    const d = pts([[0, 0, 0.02], [1, 0, 0.1], [2, 0, 0.5], [3, 0, 0.5], [4, 0, 0.5], [5, 0, 0.5], [6, 0, 0.5], [7, 0, 0.5], [8, 0, 1]]);
    clampPressureEdges(d, 9);
    expect(d[2]).toBeGreaterThan(0.1);
    expect(d[8 * PSTRIDE + 2]).toBeLessThanOrEqual(0.66);
  });
  it("erkennt Punkte", () => {
    expect(isDot(pts([[0, 0, 0.5], [0.2, 0, 0.5], [0.4, 0, 0.5]]), 3, 2)).toBe(true);
    expect(isDot(pts([[0, 0, 0.5], [5, 0, 0.5], [10, 0, 0.5]]), 3, 2)).toBe(false);
  });
  it("dünnt kleine Stifte weniger aus", () => {
    expect(tuneForWidth({ thinning: 0.6 }, 1).thinning!).toBeLessThan(tuneForWidth({ thinning: 0.6 }, 8).thinning!);
  });
});
