import { describe, expect, it } from "vitest";
import katex from "katex";
import { inkToLatex, isBar, latexToPlain, textToLatex } from "./latex";

const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const valid = (s: string) => expect(() => katex.renderToString(s, { throwOnError: true })).not.toThrow();

describe("textToLatex", () => {
  it.each([
    ["a·b", "a \\cdot b"],
    ["2×3", "2 \\times 3"],
    ["x≤5", "x \\le 5"],
    ["α+β", "\\alpha +\\beta"],
    ["√2", "\\sqrt{2}"],
    ["sqrt(x+1)", "\\sqrt{x+1}"],
    ["x²", "x^{2}"],
    ["sin(x)", "\\sin (x)"],
    ["1/2", "\\frac{1}{2}"],
    ["(a+b)/c", "\\frac{a+b}{c}"],
    ["v−w", "v-w"],
  ])("%s → %s", (i, o) => {
    expect(textToLatex(i)).toBe(o);
    valid(textToLatex(i));
  });
});

describe("inkToLatex", () => {
  it("erkennt Bruchstriche", () => {
    const words = [
      { text: "a+b", bbox: b(10, 0, 40, 20) },
      { text: "-", bbox: b(5, 28, 50, 3) },
      { text: "c", bbox: b(25, 40, 12, 20) },
      { text: "=", bbox: b(70, 22, 15, 10) },
      { text: "1", bbox: b(95, 18, 8, 20) },
    ];
    const s = inkToLatex(words, [b(5, 28, 50, 3)]);
    expect(s).toBe("\\frac{a+b}{c}=1");
    valid(s);
  });

  it("verschachtelte Brüche, innen zuerst", () => {
    const words = [
      { text: "1", bbox: b(30, 0, 8, 18) },
      { text: "x", bbox: b(30, 30, 8, 14) },
      { text: "2", bbox: b(30, 62, 8, 18) },
    ];
    const s = inkToLatex(words, [b(25, 24, 20, 2), b(10, 52, 60, 3)]);
    expect(s).toBe("\\frac{\\frac{1}{x}}{2}");
    valid(s);
  });

  it("Hoch- und Tiefstellung über Position", () => {
    const words = [
      { text: "x", bbox: b(0, 10, 14, 20) },
      { text: "2", bbox: b(16, 0, 8, 11) },
      { text: "+a", bbox: b(30, 10, 24, 20) },
      { text: "n", bbox: b(56, 24, 8, 10) },
    ];
    const s = inkToLatex(words, []);
    expect(s).toBe("x^{2}+a_{n}");
    valid(s);
  });

  it("Bruchstrich-Erkennung", () => {
    expect(isBar(b(0, 0, 60, 4))).toBe(true);
    expect(isBar(b(0, 0, 10, 2))).toBe(false);
    expect(isBar(b(0, 0, 40, 30))).toBe(false);
  });
});

describe("latexToPlain", () => {
  it.each([
    ["\\frac{a+b}{c}=1", "(a+b)/c=1"],
    ["x^{2}+a_{n}", "x^2+a_n"],
    ["\\sqrt{2} \\cdot \\pi", "√(2) · π"],
    ["\\frac{\\frac{1}{x}}{2}", "(1/x)/2"],
    ["\\sin x", "sin x"],
  ])("%s → %s", (i, o) => expect(latexToPlain(i)).toBe(o));
});
