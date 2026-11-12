import { describe, expect, it } from "vitest";
import { recognize } from "./shapes";
import type { Vec } from "../core/geometry";

const jitter = (p: Vec[], a = 1.5) => p.map((v, i) => ({ x: v.x + Math.sin(i * 1.7) * a, y: v.y + Math.cos(i * 2.3) * a }));
function poly(c: Vec[], n = 20): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < c.length - 1; i++)
    for (let k = 0; k < n; k++) out.push({ x: c[i].x + ((c[i + 1].x - c[i].x) * k) / n, y: c[i].y + ((c[i + 1].y - c[i].y) * k) / n });
  out.push(c[c.length - 1]);
  return out;
}
function ell(a: number, b: number, n = 80, start = 0.3): Vec[] {
  return Array.from({ length: n }, (_, i) => {
    const t = start + (i / (n - 1)) * Math.PI * 2 * 0.97;
    return { x: 200 + Math.cos(t) * a, y: 200 + Math.sin(t) * b };
  });
}

describe("Formerkennung", () => {
  it("Linie, eingerastet waagerecht", () => {
    const s = recognize(jitter(poly([{ x: 0, y: 0 }, { x: 200, y: 6 }])))!;
    expect(s.kind).toBe("line");
    expect(s.points[1].y).toBeCloseTo(s.points[0].y, 5);
  });
  it("Pfeil", () => {
    const s = recognize(poly([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 170, y: -25 }, { x: 200, y: 0 }, { x: 170, y: 25 }]));
    expect(s?.kind).toBe("arrow");
  });
  it("Kreis und Ellipse", () => {
    expect(recognize(jitter(ell(80, 78)))?.kind).toBe("circle");
    expect(recognize(jitter(ell(120, 50)))?.kind).toBe("ellipse");
  });
  it("Rechteck, Dreieck, Vieleck", () => {
    expect(recognize(jitter(poly([{ x: 50, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }, { x: 48, y: 2 }])))?.kind).toBe("rectangle");
    expect(recognize(jitter(poly([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 160 }, { x: 2, y: 3 }])))?.kind).toBe("triangle");
    const hex = Array.from({ length: 7 }, (_, i) => ({ x: 100 + Math.cos((i * Math.PI) / 3) * 100, y: 100 + Math.sin((i * Math.PI) / 3) * 100 }));
    expect(recognize(poly(hex))?.kind).toBe("polygon");
  });
  it("Gekritzel bleibt Freihand", () => {
    const scribble = Array.from({ length: 100 }, (_, i) => ({ x: i * 3, y: Math.sin(i * 0.9) * 40 }));
    expect(recognize(scribble)).toBeNull();
  });
});
