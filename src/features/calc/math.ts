// Phase 11: Taschenrechner-Kern auf mathjs. Eingabe deutsch (Dezimalkomma, „;“ trennt Argumente),
// Winkel wahlweise Grad/Bogenmaß. Ausdrücke laufen in einer eingeschränkten mathjs-Instanz.
import { all, create, type EvalFunction, type MathJsInstance } from "mathjs";

export type AngleMode = "deg" | "rad";

function instance(mode: AngleMode): { math: MathJsInstance; compile: (e: string) => EvalFunction } {
  // predictable: sqrt(-1) → NaN statt komplex (Schulrechner-Verhalten, sauber plotbar)
  const math = create(all, { number: "number", predictable: true });
  if (mode === "deg") {
    const k = Math.PI / 180;
    const fwd = (f: (x: number) => number) => (x: number) => {
      const r = f(x * k);
      return Math.abs(r) < 1e-15 ? 0 : Math.abs(r) > 1e15 ? NaN : r; // sin(180°) = 0, tan(90°) undefiniert
    };
    const inv = (f: (x: number) => number) => (x: number) => f(x) / k;
    math.import({
      sin: fwd(Math.sin), cos: fwd(Math.cos), tan: fwd(Math.tan),
      cot: fwd((x) => 1 / Math.tan(x)),
      asin: inv(Math.asin), acos: inv(Math.acos), atan: inv(Math.atan),
    }, { override: true });
  }
  const compile = math.compile;
  // Kein Zugriff auf Metafunktionen aus Ausdrücken heraus (mathjs-Sicherheitshinweise)
  const blocked = (name: string) => () => { throw new Error(`Funktion „${name}“ ist im Rechner nicht verfügbar`); };
  math.import(Object.fromEntries(
    ["import", "createUnit", "evaluate", "parse", "compile", "simplify", "derivative", "resolve", "reviver", "replacer"]
      .map((n) => [n, blocked(n)])), { override: true });
  return { math, compile };
}

let cache: Partial<Record<AngleMode, ReturnType<typeof instance>>> = {};
const get = (m: AngleMode) => (cache[m] ??= instance(m));
/** Nur für Tests: Instanzen neu erzeugen. */
export const resetMath = () => { cache = {}; };

/** Schreibweisen aus Tastenfeld/Schule in mathjs-Syntax übersetzen. */
export function normalize(input: string): string {
  return input
    .replace(/[×·⋅]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-")
    .replace(/π/g, "pi").replace(/√/g, "sqrt").replace(/²/g, "^2").replace(/³/g, "^3")
    .replace(/(\d),(\d)/g, "$1.$2")   // Dezimalkomma
    .replace(/;/g, ",")               // Argumenttrenner
    .replace(/\blog\(/g, "log10(").replace(/\blg\(/g, "log10(").replace(/\bln\(/g, "log(")
    .trim();
}

const nf = new Intl.NumberFormat("de-DE", { maximumSignificantDigits: 12, useGrouping: false });

/** Zahl deutsch formatieren; sehr große/kleine Beträge wissenschaftlich. */
export function fmtNumber(v: number, digits = 12): string {
  if (Number.isNaN(v)) return "nicht definiert";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e12 || a < 1e-6) {
    const [m, e] = v.toExponential(Math.min(digits, 10) - 1).split("e");
    return `${String(Number(m)).replace(".", ",")} · 10^${Number(e)}`;
  }
  return digits === 12 ? nf.format(v) : new Intl.NumberFormat("de-DE", { maximumSignificantDigits: digits, useGrouping: false }).format(v);
}

export function fmtValue(v: unknown, math?: MathJsInstance): string {
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "boolean") return v ? "wahr" : "falsch";
  if (typeof v === "function") return "Funktion definiert";
  if (v == null) return "";
  const s = (math ?? get("rad").math).format(v as never, { precision: 12 });
  return s.replace(/(\d)\.(\d)/g, "$1,$2");
}

export interface CalcResult { ok: true; value: unknown; text: string }
export interface CalcError { ok: false; error: string }

/** Rechnet einen Ausdruck aus; `scope` hält Variablen und `ans` über Aufrufe hinweg. */
export function calculate(input: string, scope: Map<string, unknown>, mode: AngleMode): CalcResult | CalcError {
  const src = normalize(input);
  if (!src) return { ok: false, error: "Leere Eingabe" };
  const { math, compile } = get(mode);
  try {
    const value = compile(src).evaluate(scope);
    if (value === undefined) return { ok: false, error: "Kein Ergebnis" };
    if (typeof value !== "function") scope.set("ans", value);
    return { ok: true, value, text: fmtValue(value, math) };
  } catch (e) {
    return { ok: false, error: germanError(e) };
  }
}

function germanError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Undefined symbol (\w+)/.test(m)) return `Unbekannter Name „${/Undefined symbol (\w+)/.exec(m)![1]}“`;
  if (/Undefined function (\w+)/.test(m)) return `Unbekannte Funktion „${/Undefined function (\w+)/.exec(m)![1]}“`;
  if (/Unexpected end of expression/.test(m)) return "Ausdruck unvollständig";
  if (/Parenthesis \) expected/.test(m)) return "Klammer „)“ fehlt";
  if (/Unexpected|Value expected|Syntax/i.test(m)) return "Ausdruck fehlerhaft";
  if (/Too many arguments|Too few arguments/.test(m)) return "Falsche Anzahl Argumente (mit „;“ trennen)";
  return m;
}

/** Funktionsterm „f(x) = …“, „y = …“ oder nur „…“ in eine schnelle Funktion x ↦ y übersetzen. */
export function compileFn(input: string): ((x: number) => number) | { error: string } {
  const body = normalize(input.replace(/^\s*(?:[a-zA-Z]\w*\s*\(\s*x\s*\)|y)\s*=\s*/, ""));
  if (!body) return { error: "Leer" };
  const { compile } = get("rad");
  let code: EvalFunction;
  try {
    code = compile(body);
  } catch (e) {
    return { error: germanError(e) };
  }
  const scope = new Map<string, unknown>();
  const f = (x: number) => {
    scope.set("x", x);
    try {
      const v = code.evaluate(scope);
      return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : NaN;
    } catch {
      return NaN;
    }
  };
  // Probe: unbekannte Namen sofort melden statt still NaN
  try {
    scope.set("x", 0.5);
    const v = code.evaluate(scope);
    if (typeof v !== "number" && typeof v !== "boolean") return { error: "Term liefert keine Zahl" };
  } catch (e) {
    const msg = germanError(e);
    if (/Unbekannt/.test(msg)) return { error: msg };
  }
  return f;
}
