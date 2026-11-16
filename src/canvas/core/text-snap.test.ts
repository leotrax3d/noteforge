import { describe, expect, it } from "vitest";
import { placeText, snapTextPos, DEFAULT_METRICS } from "./text-snap";
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

describe("snapTextPos – Verschieben nach Alt-Zug", () => {
  const grid = setup("grid", 5);
  const placed = placeText(grid, { x: 103, y: 207 });
  const box = { lh: placed.lineHeight!, size: placed.size, grid: true };
  const onGrid = (p: { x: number; y: number }) => {
    const ref = placeText(grid, { x: p.x, y: p.y + 1 });
    return Math.abs(((p.y - placed.y) / box.lh) % 1) < 1e-6 && Math.abs(((p.x - placed.x) / box.lh) % 1) < 1e-6 && ref !== null;
  };

  it("frei verschobene Box rastet wieder auf das gemeinsame Raster ein (kein eigener Ursprung)", () => {
    const free = { x: placed.x + 7.3, y: placed.y + 11.9 }; // Alt-Zug: neben dem Raster
    const back = snapTextPos(grid, { x: free.x + 3 * box.lh, y: free.y + 2 * box.lh }, box);
    expect(onGrid(back)).toBe(true);
    // gleiches Ergebnis wie eine nie frei verschobene Box an derselben Stelle
    const other = placeText(grid, { x: back.x, y: back.y + box.lh / 2 });
    expect(back.y).toBeCloseTo(other.y);
    expect(back.x).toBeCloseTo(other.x);
  });

  it("bleibt idempotent und lässt Positionen auf dem Raster unverändert", () => {
    const p = snapTextPos(grid, { x: placed.x, y: placed.y }, box);
    expect(p.x).toBeCloseTo(placed.x);
    expect(p.y).toBeCloseTo(placed.y);
    const q = snapTextPos(grid, { x: placed.x + 2 * box.lh, y: placed.y + 4 * box.lh }, box);
    expect(snapTextPos(grid, q, box)).toEqual(q);
  });

  it("liniert: nur Grundlinie, x bleibt frei; leeres Blatt: keine Änderung", () => {
    const lines = setup("lines");
    const pl = placeText(lines, { x: 50, y: 300 });
    const b = { lh: pl.lineHeight!, size: pl.size, grid: false };
    const r = snapTextPos(lines, { x: 61.5, y: pl.y + 13 }, b);
    expect(r.x).toBe(61.5);
    expect(Math.abs(((r.y - pl.y) / b.lh) % 1) < 1e-6 || Math.abs(Math.abs(((r.y - pl.y) / b.lh) % 1) - 1) < 1e-6).toBe(true);
    expect(snapTextPos(setup("blank"), { x: 1, y: 2 }, b)).toEqual({ x: 1, y: 2 });
  });
});
