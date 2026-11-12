import { describe, expect, it } from "vitest";
import { decodeStroke, encodeStroke, elementToStroke, strokeToElement } from "./codec";
import { invertLightness, luminance } from "./color";
import { eraseFromStroke, hitStroke, similarity, strokeInLasso, transformStroke, apply } from "./geometry";
import { a4PageCount, a4Size, A4_GAP, MM } from "./layout";
import { PSTRIDE, makeStroke, type Stroke } from "./model";
import { StrokeStore } from "./store";

function line(id: string, x0: number, x1: number, y = 0, n = 21, z = 0): Stroke {
  const pts = new Float32Array(n * PSTRIDE);
  for (let i = 0; i < n; i++) {
    pts[i * PSTRIDE] = x0 + ((x1 - x0) * i) / (n - 1);
    pts[i * PSTRIDE + 1] = y;
    pts[i * PSTRIDE + 2] = 0.5;
    pts[i * PSTRIDE + 4] = i * 8;
  }
  return makeStroke({ id, z, pen: "fountain", color: "#1e3a8a", width: 2, opacity: 1, pressure: true, points: pts });
}

describe("Codec", () => {
  it("Roundtrip binär und als Element", () => {
    const s = { ...line("a", 0, 100), pen: "highlighter" as const, color: "#fde047", opacity: 0.38 };
    const d = decodeStroke("a", 3, encodeStroke(s));
    expect(d).toMatchObject({ id: "a", z: 3, pen: "highlighter", color: "#fde047", width: 2, pressure: true });
    expect(d.opacity).toBeCloseTo(0.38);
    expect(Array.from(d.points)).toEqual(Array.from(s.points));
    const el = strokeToElement(d, "page");
    expect(el.type).toBe("stroke");
    expect(elementToStroke(JSON.parse(JSON.stringify(el)))!.points.length).toBe(s.points.length);
    expect(elementToStroke({ ...el, data: [9, 9, 9] })).toBeNull();
  });
});

describe("Tinten-Inversion", () => {
  it("dunkel wird hell, Farbton bleibt", () => {
    expect(invertLightness("#000000")).toBe("#ffffff");
    expect(invertLightness("#ffffff")).toBe("#000000");
    const navy = invertLightness("#1e3a8a");
    expect(luminance(navy)).toBeGreaterThan(0.5);
    const [r, , b] = [parseInt(navy.slice(1, 3), 16), 0, parseInt(navy.slice(5, 7), 16)];
    expect(b).toBeGreaterThan(r); // bleibt blau
  });
});

describe("Geometrie", () => {
  it("Treffer und Strichradierer", () => {
    const s = line("a", 0, 100);
    expect(hitStroke(s, 50, 3, 2)).toBe(true);
    expect(hitStroke(s, 50, 20, 2)).toBe(false);
  });

  it("partielles Radieren teilt den Strich", () => {
    const s = line("a", 0, 100);
    const parts = eraseFromStroke(s, 50, 0, 5)!;
    expect(parts).toHaveLength(2);
    const maxX = Math.max(...Array.from(parts[0].points).filter((_, i) => i % PSTRIDE === 0));
    const minX = Math.min(...Array.from(parts[1].points).filter((_, i) => i % PSTRIDE === 0));
    expect(maxX).toBeLessThan(45);
    expect(maxX).toBeGreaterThan(40); // Randpunkt interpoliert
    expect(minX).toBeGreaterThan(55);
    expect(eraseFromStroke(s, 50, 50, 5)).toBeNull();
    expect(eraseFromStroke(s, 0, 0, 500)).toEqual([]);
  });

  it("Lasso und Transformation", () => {
    const s = line("a", 10, 90, 50);
    const poly = [0, 0, 100, 0, 100, 100, 0, 100];
    expect(strokeInLasso(s, poly)).toBe(true);
    expect(strokeInLasso(s, [0, 0, 30, 0, 30, 100, 0, 100])).toBe(false);
    const m = similarity({ x: 50, y: 50 }, 10, 0, Math.PI / 2, 2);
    const c = apply(m, 50, 50);
    expect(c.x).toBeCloseTo(60);
    expect(c.y).toBeCloseTo(50);
    const t = transformStroke(s, m);
    expect(t.id).toBe("a");
    expect(t.width).toBeCloseTo(4);
    expect(t.points[0]).toBeCloseTo(60); // (10,50) → um 90° gedreht, ×2
    expect(t.points[1]).toBeCloseTo(-30);
  });
});

describe("DIN A4", () => {
  it("immer eine leere Seite unten", () => {
    const { w, h } = a4Size("portrait");
    expect(w).toBeCloseTo(210 * MM);
    expect(a4Size("landscape").w).toBeCloseTo(h);
    expect(a4PageCount(0, "portrait")).toBe(1);
    expect(a4PageCount(10, "portrait")).toBe(2);
    expect(a4PageCount(h + A4_GAP + 10, "portrait")).toBe(3);
  });
});

describe("StrokeStore", () => {
  it("Undo/Redo und ausstehende Speicherungen", () => {
    const st = new StrokeStore();
    const a = line("a", 0, 10), b = line("b", 0, 10, 5, 21, 1);
    st.commit({ add: [a], remove: [] });
    st.commit({ add: [b], remove: [] });
    expect(st.takePending().upserts.map((s) => s.id).sort()).toEqual(["a", "b"]);
    const moved = { ...b, color: "#ff0000" };
    st.commit({ add: [moved], remove: [b] });
    expect(st.get("b")!.color).toBe("#ff0000");
    expect(st.takePending()).toEqual({ upserts: [moved], deletes: [] });
    st.undo();
    expect(st.get("b")!.color).toBe("#1e3a8a");
    st.undo();
    expect(st.get("b")).toBeUndefined();
    expect(st.takePending().deletes).toEqual(["b"]);
    st.redo();
    expect(st.size).toBe(2);
    expect(st.canRedo).toBe(true);
    st.commit({ add: [line("c", 0, 1)], remove: [] });
    expect(st.canRedo).toBe(false);
  });

  it("Textmarker liegen unter der Schrift", () => {
    const st = new StrokeStore();
    st.load([line("ink", 0, 1, 0, 21, 0), { ...line("hl", 0, 1, 0, 21, 5), pen: "highlighter" }]);
    expect(st.all().map((s) => s.id)).toEqual(["hl", "ink"]);
  });
});

describe("Umriss-Cache", () => {
  it("wird bei Transformation und Radieren nicht mitkopiert", () => {
    const s = { ...line("a", 0, 100), path: {} as Path2D };
    expect(transformStroke(s, similarity({ x: 0, y: 0 }, 5, 5, 0, 1)).path).toBeUndefined();
    for (const p of eraseFromStroke(s, 50, 0, 5)!) expect(p.path).toBeUndefined();
  });
});
