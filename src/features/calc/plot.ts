// Phase 11: Funktionsplotter – Kurvendiskussion (numerisch) und SVG-Ausgabe.
// Das SVG dient als Vorschau und als Bild auf dem Blatt; die Spezifikation bleibt am Element (editierbar).
import { compileFn, fmtNumber } from "./math";

export interface PlotFn { expr: string; color: string }
export interface PlotSpec {
  v: 1;
  fns: PlotFn[];
  xMin: number; xMax: number; yMin: number; yMax: number;
  grid: boolean;
  /** Nullstellen/Extrema/Schnittpunkte markieren */
  points: boolean;
}
export type PointKind = "root" | "max" | "min" | "cross";
export interface PlotPoint { kind: PointKind; x: number; y: number; fn: number; other?: number }

export const PLOT_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];
export const MAX_FNS = PLOT_COLORS.length;
export const defaultSpec = (): PlotSpec => ({
  v: 1, fns: [{ expr: "", color: PLOT_COLORS[0] }], xMin: -10, xMax: 10, yMin: -7, yMax: 7, grid: true, points: true,
});

export type Fn = (x: number) => number;
export function compileAll(spec: PlotSpec): (Fn | { error: string } | null)[] {
  return spec.fns.map((f) => (f.expr.trim() ? compileFn(f.expr) : null));
}
const isFn = (f: unknown): f is Fn => typeof f === "function";

const N = 1200;
const fin = Number.isFinite;

function bisect(g: Fn, a: number, b: number, ga: number): number {
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2, gm = g(m);
    if (!fin(gm)) return NaN;
    if (gm === 0) return m;
    if (Math.sign(gm) === Math.sign(ga)) { a = m; ga = gm; } else b = m;
    if (b - a < 1e-13 * Math.max(1, Math.abs(a))) break;
  }
  return (a + b) / 2;
}

/** Goldener Schnitt: Maximum von s·g in [a, b]. */
function golden(g: Fn, a: number, b: number, s: 1 | -1): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a), d = a + r * (b - a);
  let gc = s * g(c), gd = s * g(d);
  for (let i = 0; i < 100 && b - a > 1e-12 * Math.max(1, Math.abs(a)); i++) {
    if (gc > gd) { b = d; d = c; gd = gc; c = b - r * (b - a); gc = s * g(c); }
    else { a = c; c = d; gc = gd; d = a + r * (b - a); gd = s * g(d); }
  }
  return (a + b) / 2;
}

/** Nullstellen von g im Intervall (Vorzeichenwechsel + Berührpunkte), ohne Polstellen. */
export function roots(g: Fn, x0: number, x1: number, n = N): number[] {
  const out: number[] = [];
  const dx = (x1 - x0) / n;
  let pa = x0, ga = g(x0);
  const ys: number[] = [ga];
  for (let i = 1; i <= n; i++) {
    const b = x0 + i * dx, gb = g(b);
    ys.push(gb);
    if (fin(ga) && fin(gb)) {
      if (ga === 0) out.push(pa);
      else if (Math.sign(ga) !== Math.sign(gb) && gb !== 0) {
        const r = bisect(g, pa, b, ga);
        // Polstelle (1/x): Vorzeichenwechsel ohne kleinen Funktionswert
        const scale = Math.max(1e-9, Math.abs(ga), Math.abs(gb));
        if (fin(r) && Math.abs(g(r)) < 1e-6 * Math.max(1, scale)) out.push(r);
      }
    }
    pa = b; ga = gb;
  }
  if (fin(ga) && ga === 0) out.push(x1);
  // Berührpunkte (x²): lokales Minimum von |g| nahe 0 ohne Vorzeichenwechsel
  for (let i = 1; i < n; i++) {
    const [a, m, b] = [ys[i - 1], ys[i], ys[i + 1]];
    if (!fin(a) || !fin(m) || !fin(b) || Math.sign(a) !== Math.sign(b) || m === 0) continue;
    if (Math.abs(m) <= Math.abs(a) && Math.abs(m) <= Math.abs(b)) {
      const xm = golden((x) => -Math.abs(g(x)), x0 + (i - 1) * dx, x0 + (i + 1) * dx, 1);
      if (Math.abs(g(xm)) < 1e-7) out.push(xm);
    }
  }
  return dedupe(out.sort((a, b) => a - b), (x1 - x0) * 1e-6);
}

function dedupe(xs: number[], eps: number) {
  return xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > eps);
}

/** Lokale Extrema über Steigungswechsel der Stichprobe, verfeinert per goldenem Schnitt. */
export function extrema(f: Fn, x0: number, x1: number, n = N): { x: number; y: number; kind: "max" | "min" }[] {
  const dx = (x1 - x0) / n;
  const ys = Array.from({ length: n + 1 }, (_, i) => f(x0 + i * dx));
  const out: { x: number; y: number; kind: "max" | "min" }[] = [];
  for (let i = 1; i < n; i++) {
    const [a, m, b] = [ys[i - 1], ys[i], ys[i + 1]];
    if (!fin(a) || !fin(m) || !fin(b)) continue;
    const kind = m > a && m >= b ? "max" : m < a && m <= b ? "min" : null;
    if (!kind) continue;
    const x = golden(f, x0 + (i - 1) * dx, x0 + (i + 1) * dx, kind === "max" ? 1 : -1);
    const y = f(x);
    // Knick/Pol: Wert passt nicht zur Umgebung
    if (!fin(y) || Math.abs(y - m) > 10 * (Math.abs(a - m) + Math.abs(b - m)) + 1e-9) continue;
    out.push({ x, y, kind });
  }
  return out.filter((p, i) => i === 0 || Math.abs(p.x - out[i - 1].x) > (x1 - x0) * 1e-6);
}

/** Alle markierbaren Punkte im sichtbaren Bereich. */
export function analyze(spec: PlotSpec, fns = compileAll(spec)): PlotPoint[] {
  const { xMin, xMax, yMin, yMax } = spec;
  const inView = (y: number) => y >= yMin && y <= yMax;
  const pts: PlotPoint[] = [];
  fns.forEach((f, i) => {
    if (!isFn(f)) return;
    for (const x of roots(f, xMin, xMax)) if (inView(0)) pts.push({ kind: "root", x, y: 0, fn: i });
    for (const e of extrema(f, xMin, xMax)) if (inView(e.y)) pts.push({ kind: e.kind, x: e.x, y: e.y, fn: i });
    for (let j = i + 1; j < fns.length; j++) {
      const g = fns[j];
      if (!isFn(g)) continue;
      for (const x of roots((t) => f(t) - g(t), xMin, xMax)) {
        const y = f(x);
        if (inView(y)) pts.push({ kind: "cross", x, y, fn: i, other: j });
      }
    }
  });
  return pts.map((p) => ({ ...p, x: clean(p.x), y: clean(p.y) }));
}

/** Rundungsrauschen entfernen (−0, 1,9999999999). */
function clean(v: number) {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
}

/** y-Bereich aus den Funktionswerten (robust gegen Polstellen: 5.–95. Perzentil, etwas Rand). */
export function autoY(spec: PlotSpec, fns = compileAll(spec)): { yMin: number; yMax: number } | null {
  const ys: number[] = [];
  for (const f of fns) {
    if (!isFn(f)) continue;
    for (let i = 0; i <= 400; i++) {
      const y = f(spec.xMin + ((spec.xMax - spec.xMin) * i) / 400);
      if (fin(y)) ys.push(y);
    }
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  let lo = ys[Math.floor(ys.length * 0.05)], hi = ys[Math.ceil(ys.length * 0.95) - 1];
  lo = Math.min(lo, 0); hi = Math.max(hi, 0); // x-Achse sichtbar halten
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  return { yMin: niceRound(lo - pad), yMax: niceRound(hi + pad) };
}
function niceRound(v: number) {
  const s = niceStep(Math.abs(v) || 1, 10);
  return Math.round(v / s) * s;
}

/** „Schöne“ Teilung 1/2/5·10^k für etwa `target` Abschnitte. */
export function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const POINT_LABEL: Record<PointKind, string> = { root: "N", max: "H", min: "T", cross: "S" };
export const POINT_TEXT: Record<PointKind, string> = { root: "Nullstelle", max: "Hochpunkt", min: "Tiefpunkt", cross: "Schnittpunkt" };
export const fmtCoord = (v: number) => fmtNumber(v, 5);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Funktionsname für Legende/Liste: f, g, h, … */
export const fnName = (i: number) => "fghkmp"[i] ?? `f${i + 1}`;

export function fnLabel(expr: string, i: number) {
  const body = expr.replace(/^\s*(?:[a-zA-Z]\w*\s*\(\s*x\s*\)|y)\s*=\s*/, "").trim();
  return `${fnName(i)}(x) = ${body}`;
}

/** Diagramm als eigenständiges SVG (feste helle Farben – liest sich auf hellem wie dunklem Blatt). */
export function plotSvg(spec: PlotSpec, w = 480, h = 360, fns = compileAll(spec), pts = spec.points ? analyze(spec, fns) : []): string {
  const { xMin, xMax, yMin, yMax } = spec;
  const pad = { l: 8, r: 8, t: 8, b: 8 };
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * W;
  const sy = (y: number) => pad.t + ((yMax - y) / (yMax - yMin)) * H;
  const r = (v: number) => Math.round(v * 10) / 10;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Segoe UI, system-ui, sans-serif" font-size="11">`);
  out.push(`<rect width="${w}" height="${h}" rx="6" fill="#ffffff" stroke="#d4d4d8"/>`);
  out.push(`<defs><clipPath id="c"><rect x="${pad.l}" y="${pad.t}" width="${W}" height="${H}"/></clipPath></defs>`);

  const xs = niceStep(xMax - xMin, Math.max(4, W / 60)), ys = niceStep(yMax - yMin, Math.max(4, H / 50));
  const ticks = (a: number, b: number, s: number) => {
    const t: number[] = [];
    for (let v = Math.ceil(a / s) * s; v <= b + s * 1e-9; v += s) t.push(Math.abs(v) < s * 1e-9 ? 0 : v);
    return t.slice(0, 200);
  };
  const tx = ticks(xMin, xMax, xs), ty = ticks(yMin, yMax, ys);
  if (spec.grid) {
    const g = [...tx.map((v) => `M${r(sx(v))} ${pad.t}V${pad.t + H}`), ...ty.map((v) => `M${pad.l} ${r(sy(v))}H${pad.l + W}`)];
    out.push(`<path d="${g.join("")}" stroke="#e4e4e7" stroke-width="1"/>`);
  }
  // Achsen (an den Rand geklemmt, wenn 0 außerhalb liegt)
  const ax = Math.min(Math.max(sy(0), pad.t), pad.t + H), ay = Math.min(Math.max(sx(0), pad.l), pad.l + W);
  out.push(`<path d="M${pad.l} ${r(ax)}H${pad.l + W}M${r(ay)} ${pad.t}V${pad.t + H}" stroke="#52525b" stroke-width="1.2"/>`);
  out.push(`<path d="M${pad.l + W} ${r(ax)}l-7 -3.5v7zM${r(ay)} ${pad.t}l-3.5 7h7z" fill="#52525b"/>`);
  out.push(`<text x="${pad.l + W - 4}" y="${r(ax - 6)}" text-anchor="end" fill="#3f3f46" font-style="italic">x</text>`);
  out.push(`<text x="${r(ay + 6)}" y="${pad.t + 12}" fill="#3f3f46" font-style="italic">y</text>`);
  const lab: string[] = [];
  for (const v of tx) if (v !== 0) lab.push(`<text x="${r(sx(v))}" y="${r(Math.min(ax + 13, pad.t + H - 2))}" text-anchor="middle">${esc(fmtNumber(v, 6))}</text>`);
  for (const v of ty) if (v !== 0) lab.push(`<text x="${r(ay - 4)}" y="${r(sy(v) + 4)}" text-anchor="end">${esc(fmtNumber(v, 6))}</text>`);
  out.push(`<g fill="#71717a">${lab.join("")}</g>`);
  out.push(`<path d="${tx.map((v) => `M${r(sx(v))} ${r(ax - 3)}v6`).join("")}${ty.map((v) => `M${r(ay - 3)} ${r(sy(v))}h6`).join("")}" stroke="#52525b"/>`);

  // Kurven: Pfad an Lücken und Polen (Sprung größer als die Höhe) auftrennen
  out.push(`<g clip-path="url(#c)" fill="none" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">`);
  fns.forEach((f, i) => {
    if (!isFn(f)) return;
    const n = Math.ceil(W * 1.5);
    let d = "", prev: number | null = null;
    const lim = (y: number) => Math.max(-H * 4, Math.min(H * 5, y));
    for (let k = 0; k <= n; k++) {
      const x = xMin + ((xMax - xMin) * k) / n, y = f(x);
      if (!fin(y)) { prev = null; continue; }
      const py = sy(y);
      if (prev == null || Math.abs(py - prev) > H * 1.2) d += `M${r(sx(x))} ${r(lim(py))}`;
      else d += `L${r(sx(x))} ${r(lim(py))}`;
      prev = py;
    }
    if (d) out.push(`<path d="${d}" stroke="${esc(spec.fns[i].color)}"/>`);
  });
  out.push(`</g>`);

  // Markierte Punkte
  const marks = pts.map((p) => {
    const c = esc(spec.fns[p.fn]?.color ?? "#000");
    const x = r(sx(p.x)), y = r(sy(p.y));
    return `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${c}" stroke-width="2"/>` +
      `<text x="${x + 6}" y="${y - 6}" fill="${c}" font-weight="600">${POINT_LABEL[p.kind]}</text>`;
  });
  if (marks.length) out.push(`<g clip-path="url(#c)">${marks.join("")}</g>`);

  // Legende
  const leg = spec.fns.map((f, i) => ({ f, i })).filter(({ i }) => isFn(fns[i]));
  if (leg.length) {
    const lw = Math.min(W - 16, Math.max(...leg.map(({ f, i }) => fnLabel(f.expr, i).length)) * 6.4 + 28);
    out.push(`<rect x="${pad.l + 6}" y="${pad.t + 6}" width="${r(lw)}" height="${leg.length * 16 + 6}" rx="4" fill="#ffffff" fill-opacity="0.9" stroke="#e4e4e7"/>`);
    leg.forEach(({ f, i }, k) => {
      const y = pad.t + 20 + k * 16;
      out.push(`<path d="M${pad.l + 12} ${y - 4}h12" stroke="${esc(f.color)}" stroke-width="3"/>`);
      out.push(`<text x="${pad.l + 30}" y="${y}" fill="#18181b">${esc(fnLabel(f.expr, i))}</text>`);
    });
  }
  out.push(`</svg>`);
  return out.join("");
}

export { svgDataUrl } from "./calc-store";

/** Bereich um den Mittelpunkt zoomen (f < 1 = hinein). */
export function zoomSpec(s: PlotSpec, f: number, cx = (s.xMin + s.xMax) / 2, cy = (s.yMin + s.yMax) / 2): PlotSpec {
  return { ...s, xMin: cx - (cx - s.xMin) * f, xMax: cx + (s.xMax - cx) * f, yMin: cy - (cy - s.yMin) * f, yMax: cy + (s.yMax - cy) * f };
}

export function validRange(s: PlotSpec): string | null {
  if (![s.xMin, s.xMax, s.yMin, s.yMax].every(fin)) return "Bereich ungültig";
  if (s.xMax - s.xMin < 1e-9 || s.yMax - s.yMin < 1e-9) return "Minimum muss kleiner als Maximum sein";
  return null;
}
