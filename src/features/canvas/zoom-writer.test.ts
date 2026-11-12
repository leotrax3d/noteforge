import { describe, expect, it } from "vitest";
import { smoothSmall } from "./ZoomWriter";

describe("Zoom-Schreibfeld", () => {
  it("glättet und verwirft fast identische Punkte, Endpunkte bleiben", () => {
    const pts = [0, 0, 0.5, 0, 0, 0.01, 0, 0.5, 0, 1, 1, 1, 0.5, 0, 2, 2, 0, 0.5, 0, 3];
    const out = smoothSmall(pts, 0.12);
    expect(out.length / 5).toBe(3);
    expect(out[0]).toBe(0);
    expect(out[10]).toBe(2);
    expect(out[5]).toBeCloseTo(1);
    expect(out[6]).toBeCloseTo(0.5);
  });
});
