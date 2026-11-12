import { describe, expect, it } from "vitest";
import { calculate, compileFn, fmtNumber, normalize } from "./math";
import { analyze, autoY, defaultSpec, extrema, niceStep, plotSvg, roots, type PlotSpec } from "./plot";

const calc = (s: string, mode: "deg" | "rad" = "rad", scope = new Map<string, unknown>()) => calculate(s, scope, mode);
const text = (s: string, mode: "deg" | "rad" = "rad") => { const r = calc(s, mode); return r.ok ? r.text : `ERR ${r.error}`; };

describe("Rechner", () => {
  it("deutsche Eingabe", () => {
    expect(normalize("2,5 × 3")).toBe("2.5 * 3");
    expect(normalize("max(1;2,5)")).toBe("max(1,2.5)");
    expect(normalize("√(16) + π²")).toBe("sqrt(16) + pi^2");
    expect(normalize("log(100) + ln(e)")).toBe("log10(100) + log(e)");
    expect(text("2,5 × 3")).toBe("7,5");
    expect(text("max(1;2,5)")).toBe("2,5");
    expect(text("log(1000)")).toBe("3");
    expect(text("ln(e)")).toBe("1");
    expect(text("0.1 + 0.2")).toBe("0,3");
    expect(text("1/3")).toBe("0,333333333333");
  });
  it("Grad und Bogenmaß", () => {
    expect(text("sin(30)", "deg")).toBe("0,5");
    expect(text("sin(180)", "deg")).toBe("0");
    expect(text("asin(0,5)", "deg")).toBe("30");
    expect(text("tan(90)", "deg")).toBe("nicht definiert");
    expect(text("sin(pi/2)")).toBe("1");
  });
  it("Variablen, ans, Fehler", () => {
    const sc = new Map<string, unknown>();
    expect(calc("a = 4", "rad", sc).ok).toBe(true);
    expect(calc("a^2", "rad", sc)).toMatchObject({ text: "16" });
    expect(calc("ans + 1", "rad", sc)).toMatchObject({ text: "17" });
    expect(text("sqrt(-1)")).toBe("nicht definiert");
    expect(text("foo + 1")).toBe("ERR Unbekannter Name „foo“");
    expect(text("(1+2")).toMatch(/^ERR/);
    expect(text("import({}, {})")).toMatch(/nicht verfügbar/);
    expect(text("evaluate(\"1\")")).toMatch(/nicht verfügbar/);
    expect(fmtNumber(1.5e15)).toBe("1,5 · 10^15");
    expect(fmtNumber(-0.0000002)).toBe("-2 · 10^-7");
  });
});

describe("Plotter", () => {
  const fn = (s: string) => compileFn(s) as (x: number) => number;
  it("Terme übersetzen", () => {
    expect(fn("f(x) = x^2")(3)).toBe(9);
    expect(fn("y = 2x + 1")(2)).toBe(5);
    expect(fn("sin(x)")(0)).toBe(0);
    expect(compileFn("x + q")).toEqual({ error: "Unbekannter Name „q“" });
    expect(compileFn("x +")).toHaveProperty("error");
  });
  it("Nullstellen inkl. Berührpunkt, ohne Polstelle", () => {
    const r = roots(fn("x^2 - 4"), -10, 10);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(-2, 9);
    expect(r[1]).toBeCloseTo(2, 9);
    const t = roots(fn("(x-1)^2"), -10, 10);
    expect(t).toHaveLength(1);
    expect(t[0]).toBeCloseTo(1, 5);
    expect(roots(fn("1/x"), -10, 10)).toHaveLength(0);
    expect(roots(fn("sin(x)"), -7, 7).length).toBe(5);
  });
  it("Extrema", () => {
    const e = extrema(fn("x^3 - 3x"), -5, 5);
    expect(e.map((p) => p.kind)).toEqual(["max", "min"]);
    expect(e[0].x).toBeCloseTo(-1, 5);
    expect(e[0].y).toBeCloseTo(2, 8);
    expect(e[1].x).toBeCloseTo(1, 5);
    expect(extrema(fn("1/x^2"), -5, 5)).toHaveLength(0);
  });
  it("Analyse mit Schnittpunkten und SVG", () => {
    const s: PlotSpec = { ...defaultSpec(), fns: [{ expr: "x^2", color: "#2563eb" }, { expr: "x + 2", color: "#dc2626" }] };
    const p = analyze(s);
    const cross = p.filter((q) => q.kind === "cross").map((q) => [q.x, q.y]);
    expect(cross).toEqual([[-1, 1], [2, 4]]);
    expect(p.find((q) => q.kind === "min" && q.fn === 0)).toMatchObject({ x: 0, y: 0 });
    const svg = plotSvg(s);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("f(x) = x^2");
    expect(svg).toContain("g(x) = x + 2");
    expect(svg.match(/<circle/g)!.length).toBe(p.length);
    // Benutzertext wird escaped
    expect(plotSvg({ ...s, fns: [{ expr: "x<2", color: "#000" }] })).toContain("x&lt;2");
  });
  it("Achsenteilung und Auto-y", () => {
    expect(niceStep(20, 10)).toBe(2);
    expect(niceStep(1, 4)).toBe(0.2);
    const y = autoY({ ...defaultSpec(), fns: [{ expr: "x^2", color: "#000" }], xMin: -3, xMax: 3 })!;
    expect(y.yMin).toBeLessThanOrEqual(0);
    expect(y.yMax).toBeGreaterThanOrEqual(8);
  });
});
