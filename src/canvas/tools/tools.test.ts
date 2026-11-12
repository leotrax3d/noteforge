import { describe, expect, it } from "vitest";
import { displayAngle, hitGuide, makeGuide, nearestEdge, snapRotation, snapToCircle, snapToEdge, RULER_W } from "./guides";
import { elementToObj, hitObj, makeObj, objToElement, transformObj, type ImageObj, type TextObj } from "../core/objects";
import { similarity } from "../core/geometry";
import { StrokeStore } from "../core/store";
import { sanitizeHtml } from "@/features/canvas/objects/sanitize";

describe("Zeichenhilfen", () => {
  it("Lineal: Kante finden und Punkte darauf projizieren", () => {
    const g = makeGuide("ruler", { x: 0, y: 0 });
    const top = -RULER_W / 2;
    const snap = nearestEdge(g, { x: 50, y: top - 8 }, 18)!;
    expect(snap.edge).toBe(0);
    const p = snapToEdge(g, snap, { x: 120, y: top - 15 });
    expect(p.y).toBeCloseTo(top);
    expect(p.x).toBeCloseTo(120);
    expect(nearestEdge(g, { x: 0, y: top - 40 }, 18)).toBeNull();
    expect(hitGuide(g, { x: 0, y: 0 })).toBe(true);
  });
  it("Gedrehtes Geodreieck: Hypotenuse bleibt Gerade", () => {
    const g = { ...makeGuide("setsquare", { x: 100, y: 100 }), angle: Math.PI / 6 };
    const snap = nearestEdge(g, { x: 100 + 5, y: 100 - 3 }, 18)!;
    const a = snapToEdge(g, snap, { x: 160, y: 120 }), b = snapToEdge(g, snap, { x: 40, y: 70 });
    expect(Math.atan2(a.y - b.y, a.x - b.x)).toBeCloseTo(Math.PI / 6);
  });
  it("Zirkel und Winkel", () => {
    const g = makeGuide("compass", { x: 0, y: 0 });
    const p = snapToCircle(g, 50, { x: 3, y: 4 });
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(50);
    expect(snapRotation((44.2 * Math.PI) / 180)).toBeCloseTo(Math.PI / 4);
    expect(snapRotation((40 * Math.PI) / 180)).toBeCloseTo((40 * Math.PI) / 180);
    expect(displayAngle((-30 * Math.PI) / 180)).toBe(30);
    expect(displayAngle((30 * Math.PI) / 180)).toBe(150);
  });
});

describe("Objekte", () => {
  const img = makeObj<ImageObj>({ id: "i", kind: "image", z: 1, x: 0, y: 0, w: 100, h: 50, angle: 0, data: { src: "data:image/png;base64,AA==" } });
  it("Codec-Roundtrip", () => {
    const t = makeObj<TextObj>({ id: "t", kind: "text", z: 2, x: 5, y: 6, w: 300, h: 40, angle: 0, data: { html: "<b>Hallo</b> äöü" } });
    const back = elementToObj(JSON.parse(JSON.stringify(objToElement(t, "p"))));
    expect(back).toEqual(t);
    expect(elementToObj({ ...objToElement(t, "p"), data: [1, 2] })).toBeNull();
  });
  it("Transformation und Treffertest", () => {
    const m = similarity({ x: 50, y: 25 }, 10, 0, Math.PI / 2, 2);
    const o = transformObj(img, m);
    expect(o.w).toBeCloseTo(200);
    expect(o.angle).toBeCloseTo(Math.PI / 2);
    expect(o.x + o.w / 2).toBeCloseTo(60);
    expect(hitObj(o, 60, 90)).toBe(true); // gedreht: hoch statt breit
    expect(hitObj(o, 150, 25)).toBe(false);
  });
  it("Store: Undo/Redo und Speichern von Objekten", () => {
    const st = new StrokeStore();
    st.commit({ add: [], remove: [], addObj: [img] });
    expect(st.objects()).toHaveLength(1);
    expect(st.takePending().objects).toEqual([img]);
    st.undo();
    expect(st.objects()).toHaveLength(0);
    expect(st.takePending().deletes).toEqual(["i"]);
    st.redo();
    expect(st.getObj("i")).toBe(img);
  });
});

describe("Rich-Text-Bereinigung", () => {
  it("entfernt Skripte und Attribute", () => {
    const out = sanitizeHtml('<h1 onclick="x()">T</h1><script>alert(1)</script><img src=x onerror=alert(1)><span style="color: #dc2626">r</span><a href="javascript:1">l</a>');
    expect(out).toBe('<h1>T</h1>alert(1)<span style="color: #dc2626">r</span>l');
  });
});
