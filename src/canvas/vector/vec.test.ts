import { describe, expect, it } from "vitest";
import { angleDeg, defaultCoord, renderVec, type LineSpec } from "./vec";
import { snapToTerminal, terminalsOf, updateVecObj, vecObj } from "./vec-obj";

describe("vector", () => {
  it("rendert Linie mit Pfeilspitzen in Weltlage", () => {
    const o = vecObj({ t: "line", pts: [{ x: 100, y: 100 }, { x: 200, y: 100 }], color: "#000", width: 2, head0: "none", head1: "filled" }, null, 1);
    expect(o.x).toBeLessThan(100);
    expect(o.x + o.w).toBeGreaterThan(200);
    expect(decodeURIComponent(o.data.src)).toContain("<path");
    const u = updateVecObj(o, { ...(o.data.vec as LineSpec), head0: "dot" });
    expect(u.w).toBeCloseTo(o.w);
    expect(decodeURIComponent(u.data.src)).toContain("<circle");
  });
  it("Koordinatensystem enthält Beschriftung", () => {
    expect(renderVec(defaultCoord()).svg).toContain(">x<");
  });
  it("Anschlüsse rasten ein", () => {
    const r = vecObj({ t: "symbol", name: "resistor", color: "#000" }, { x: 0, y: 0 }, 1);
    expect(terminalsOf(r)).toEqual([{ x: 0, y: 20 }, { x: 80, y: 20 }]);
    expect(snapToTerminal({ x: 84, y: 23 }, [r], 10)).toEqual({ x: 80, y: 20 });
  });
  it("misst Winkel", () => {
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 1 })).toBeCloseTo(135);
  });
});
