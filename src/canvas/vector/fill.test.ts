import { describe, expect, it } from "vitest";
import { dilate, floodRegion } from "./fill";

function box(w: number, h: number, open = false) {
  const m = new Uint8Array(w * h);
  for (let x = 2; x < w - 2; x++) { m[2 * w + x] = 1; m[(h - 3) * w + x] = 1; }
  for (let y = 2; y < h - 2; y++) { m[y * w + 2] = 1; if (!(open && y === 5)) m[y * w + w - 3] = 1; }
  return m;
}

describe("fill", () => {
  it("füllt geschlossenes Rechteck", () => {
    const r = floodRegion(box(12, 12), 12, 12, 5, 5);
    expect(r).not.toBeNull();
    expect(r!.reduce((a, b) => a + b, 0)).toBe(6 * 6);
  });
  it("erkennt offenen Bereich", () => {
    expect(floodRegion(box(12, 12, true), 12, 12, 5, 5)).toBeNull();
  });
  it("verbreitert die Maske", () => {
    const m = new Uint8Array(25); m[12] = 1;
    expect(dilate(m, 5, 5, 1).reduce((a, b) => a + b, 0)).toBe(5);
  });
});
