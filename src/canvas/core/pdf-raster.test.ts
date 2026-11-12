import { describe, expect, it } from "vitest";
import { CHUNK, chunkRange, levelFor } from "./pdf-raster";

describe("pdf-raster", () => {
  it("wählt die nächsthöhere Zweierpotenz", () => {
    expect(levelFor(1)).toBe(0);
    expect(levelFor(1.1)).toBe(1);
    expect(levelFor(3)).toBe(2);
    expect(levelFor(0.3)).toBe(-1);
    expect(levelFor(1000)).toBe(5);
  });
  it("berechnet nur sichtbare Kacheln", () => {
    const ref = { asset: "a", page: 0, pw: 595, ph: 842 };
    const all = chunkRange(ref, 1, 0, 0, 595, 842);
    expect(all).toEqual({ x0: 0, y0: 0, x1: Math.ceil(1190 / CHUNK) - 1, y1: Math.ceil(1684 / CHUNK) - 1 });
    const part = chunkRange(ref, 1, 0, 0, 100, 100);
    expect(part).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });
});
