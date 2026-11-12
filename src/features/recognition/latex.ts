// Ink → LaTeX (SPEC §6): Der InkAnalyzer liefert Wörter mit Position; daraus wird hier
// die 2-D-Struktur rekonstruiert (Bruchstriche, Hoch-/Tiefstellung) und Symbole werden
// in LaTeX übersetzt. Das Ergebnis ist ein Vorschlag – der Dialog lässt es bearbeiten.
import type { Box } from "@/lib/recognition";

export interface Tok { text: string; bbox: Box }
interface Item { latex: string; bbox: Box; atom: boolean }

const SYMBOLS: [RegExp, string][] = [
  [/[·•∙*]/g, " \\cdot "], [/×/g, " \\times "], [/÷/g, " \\div "],
  [/≤|<=/g, " \\le "], [/≥|>=/g, " \\ge "], [/≠/g, " \\neq "], [/≈/g, " \\approx "],
  [/±/g, " \\pm "], [/∞/g, "\\infty "], [/→/g, " \\to "], [/°/g, "^\\circ "],
  [/∑|Σ/g, "\\sum "], [/∫/g, "\\int "], [/Δ/g, "\\Delta "], [/Ω/g, "\\Omega "],
  [/²/g, "^{2}"], [/³/g, "^{3}"], [/¹/g, "^{1}"],
];
const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "varepsilon", ζ: "zeta", η: "eta", θ: "theta",
  λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", π: "pi", ρ: "rho", σ: "sigma", τ: "tau", φ: "varphi",
  χ: "chi", ψ: "psi", ω: "omega",
};
const FUNCS = ["arcsin", "arccos", "arctan", "sin", "cos", "tan", "log", "ln", "lim", "exp"];

/** Einzelnes erkanntes Wort/Zeichenkette → LaTeX. */
export function textToLatex(raw: string): string {
  let s = raw.trim().replace(/[−–—]/g, "-");
  s = s.replace(/sqrt\s*\(([^()]*)\)/gi, "\\sqrt{$1}").replace(/√\s*\(([^()]*)\)/g, "\\sqrt{$1}").replace(/√\s*([\w.]+)/g, "\\sqrt{$1}");
  for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
  s = s.replace(/[α-ω]/g, (c) => (GREEK[c] ? `\\${GREEK[c]} ` : c));
  s = s.replace(new RegExp(`(?<![\\\\a-z])(${FUNCS.join("|")})(?![a-z])`, "gi"), (m) => `\\${m.toLowerCase()} `);
  // a/b innerhalb eines Worts → Bruch
  s = s.replace(/(?<![\\\w{])([\w.]+|\([^()]*\))\/([\w.]+|\([^()]*\))/g, (_, a: string, b: string) => `\\frac{${unparen(a)}}{${unparen(b)}}`);
  return s.replace(/\s+/g, " ").replace(/ ([}^_])/g, "$1").trim();
}

const unparen = (s: string) => (s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : s);
const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;
const union = (bs: Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Lange, flache Striche: mögliche Bruchstriche. */
export function isBar(b: Box) {
  return b.w >= 18 && b.h <= Math.max(8, b.w * 0.18);
}

const DASH = /^[-−–—_=]+$/;

/** Baut LaTeX aus Wörtern (mit Position) und den Begrenzungsrahmen der Striche. */
export function inkToLatex(words: Tok[], strokes: Box[]): string {
  const bars = strokes.filter(isBar).sort((a, b) => a.w - b.w);
  let items: Item[] = words
    .filter((w) => w.text.trim())
    .map((w) => ({ latex: textToLatex(w.text), bbox: w.bbox, atom: false }));

  for (const bar of bars) {
    const near = Math.max(bar.w, 40);
    const inX = (it: Item) => cx(it.bbox) >= bar.x - bar.w * 0.1 && cx(it.bbox) <= bar.x + bar.w * 1.1;
    // Wort, das nur der Bruchstrich selbst ist („-“)
    const self = items.filter((it) => DASH.test(it.latex) && inX(it) && Math.abs(cy(it.bbox) - cy(bar)) < Math.max(10, it.bbox.h));
    const rest = items.filter((it) => !self.includes(it));
    const num = rest.filter((it) => inX(it) && cy(it.bbox) < cy(bar) && cy(bar) - cy(it.bbox) < near);
    const den = rest.filter((it) => inX(it) && cy(it.bbox) > cy(bar) && cy(it.bbox) - cy(bar) < near);
    if (!num.length || !den.length) continue;
    const frac: Item = {
      latex: `\\frac{${linear(num)}}{${linear(den)}}`,
      bbox: union([bar, ...num.map((i) => i.bbox), ...den.map((i) => i.bbox)]),
      atom: true,
    };
    items = [...rest.filter((it) => !num.includes(it) && !den.includes(it)), frac];
  }
  return linear(items);
}

/** Eine Zeile von links nach rechts; kleinere, höher/tiefer stehende Teile werden Exponent/Index. */
function linear(items: Item[]): string {
  const sorted = [...items].sort((a, b) => a.bbox.x - b.bbox.x);
  let out = "";
  let base: Item | null = null;
  for (const it of sorted) {
    if (base && !it.atom && !OPERATOR.test(it.latex)) {
      const b = base.bbox, h = it.bbox.h;
      const small = h < b.h * 0.8;
      if (small && it.bbox.y + h < cy(b) + b.h * 0.05) { out += `^{${it.latex}}`; continue; }
      if (small && it.bbox.y > cy(b) - b.h * 0.05) { out += `_{${it.latex}}`; continue; }
    }
    out += (out && needsSpace(out, it.latex) ? " " : "") + it.latex;
    base = it;
  }
  return out;
}

/** Relationen/Operatoren stehen nie hoch/tief, auch wenn sie klein geschrieben sind. */
const OPERATOR = /^(=|<|>|\+|-|\\(cdot|times|div|le|ge|neq|approx|pm|to)\b)/;
const needsSpace = (a: string, b: string) => /\\[a-zA-Z]+$/.test(a) && /^[a-zA-Z]/.test(b);

const PLAIN: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", le: "≤", ge: "≥", neq: "≠", ne: "≠", approx: "≈", pm: "±", infty: "∞", to: "→",
  circ: "°", sum: "∑", int: "∫", Delta: "Δ", Omega: "Ω", varepsilon: "ε", varphi: "φ",
  ...Object.fromEntries(Object.entries(GREEK).map(([k, v]) => [v, k])),
};

/** Lesbare Einzeilen-Fassung einer Formel (PDF-Export ohne KaTeX-Satz). */
export function latexToPlain(src: string): string {
  let s = src;
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => `${wrap(a)}/${wrap(b)}`)
      .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
      .replace(/\^\{([^{}]*)\}/g, (_, a: string) => `^${a.length > 1 ? `(${a})` : a}`)
      .replace(/_\{([^{}]*)\}/g, (_, a: string) => `_${a.length > 1 ? `(${a})` : a}`);
    if (s === before) break;
  }
  s = s.replace(/\\([a-zA-Z]+)/g, (m, n: string) => PLAIN[n] ?? (FUNCS.includes(n) ? `${n} ` : m));
  return s.replace(/\\[,;!: ]/g, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

const wrap = (t: string) => (/^[\w.]+$/.test(t) ? t : `(${t})`);
