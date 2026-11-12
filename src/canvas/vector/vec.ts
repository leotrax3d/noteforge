// Vektor-Elemente (SPEC §4.3): Formen-Bibliothek, Linien mit Pfeilspitzen, Füllungen, Winkelbeschriftungen.
// Gespeichert als Bild-Element (ImageObj) mit `data.vec` = Spezifikation und `data.src` = gerendertes SVG.
// Dadurch gelten Auswahl, Verschieben, Skalieren, Drehen, Undo und Sync unverändert; die Spezifikation
// macht das Element nachträglich bearbeitbar (Achsen, Pfeilspitzen …).
import type { Vec } from "../core/geometry";
import { MM } from "../core/layout";

export type Head = "none" | "arrow" | "filled" | "vector" | "dot";
export const HEADS: Head[] = ["none", "arrow", "filled", "vector", "dot"];
export const HEAD_LABELS: Record<Head, string> = { none: "Keine", arrow: "Pfeil", filled: "Gefüllt", vector: "Vektorpfeil", dot: "Punkt" };

export type SymbolName = "resistor" | "lamp" | "battery" | "switch" | "voltmeter" | "ammeter" | "diode" | "capacitor";
export type LabName = "beaker" | "erlenmeyer" | "testtube" | "bunsen";

export interface LineSpec { t: "line"; pts: Vec[]; color: string; width: number; head0: Head; head1: Head; closed?: boolean }
export interface CoordSpec {
  t: "coord"; xmin: number; xmax: number; ymin: number; ymax: number;
  /** Welteinheiten pro Achseneinheit (Standard = Karo) */
  unit: number; step: number; grid: boolean; labels: boolean; xLabel: string; yLabel: string; color: string;
}
export interface NumberLineSpec { t: "numberline"; min: number; max: number; step: number; unit: number; labels: boolean; color: string }
export interface SymbolSpec { t: "symbol"; name: SymbolName; color: string }
export interface LabSpec { t: "lab"; name: LabName; color: string }
export interface StaffSpec { t: "staff"; length: number; gap: number; clef: boolean; color: string }
export interface BondSpec { t: "bond"; order: 1 | 2 | 3; length: number; color: string }
export interface FillSpec { t: "fill"; color: string; opacity: number; hatch: { angle: number; gap: number } | null }
export interface AngleSpec { t: "angle"; a: Vec; b: Vec; c: Vec; color: string }
export type VecSpec = LineSpec | CoordSpec | NumberLineSpec | SymbolSpec | LabSpec | StaffSpec | BondSpec | FillSpec | AngleSpec;

export interface Rendered {
  svg: string;
  /** Größe in Welteinheiten */
  w: number;
  h: number;
  /** Ursprung der Spezifikations-Koordinaten im Element (für Linien/Winkel: Versatz) */
  ox: number;
  oy: number;
  /** Anschlusspunkte (lokal, Welt) für Leitungen */
  terminals?: Vec[];
}

export const SYMBOL_LABELS: Record<SymbolName, string> = {
  resistor: "Widerstand", lamp: "Lampe", battery: "Batterie", switch: "Schalter",
  voltmeter: "Spannungsmessgerät", ammeter: "Strommessgerät", diode: "Diode", capacitor: "Kondensator",
};
export const LAB_LABELS: Record<LabName, string> = { beaker: "Becherglas", erlenmeyer: "Erlenmeyerkolben", testtube: "Reagenzglas", bunsen: "Bunsenbrenner" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.round(v * 100) / 100;
const FONT = `font-family="Segoe UI, system-ui, sans-serif"`;

function svgDoc(w: number, h: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">${body}</svg>`;
}

/** Pfeilspitze am Punkt `tip`, Richtung von `from` nach `tip`. */
export function headSvg(head: Head, from: Vec, tip: Vec, color: string, width: number): string {
  if (head === "none") return "";
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const L = Math.max(8, width * 4.5), W = L * 0.55;
  const pt = (d: number, s: number) => ({ x: tip.x - Math.cos(ang) * d - Math.sin(ang) * s, y: tip.y - Math.sin(ang) * d + Math.cos(ang) * s });
  const a = pt(L, W), b = pt(L, -W);
  switch (head) {
    case "dot": return `<circle cx="${n(tip.x)}" cy="${n(tip.y)}" r="${n(Math.max(2.5, width * 1.6))}" fill="${color}"/>`;
    case "filled": return `<path d="M${n(a.x)} ${n(a.y)}L${n(tip.x)} ${n(tip.y)}L${n(b.x)} ${n(b.y)}Z" fill="${color}"/>`;
    case "vector": {
      const m = pt(L * 0.7, 0);
      return `<path d="M${n(a.x)} ${n(a.y)}L${n(tip.x)} ${n(tip.y)}L${n(b.x)} ${n(b.y)}L${n(m.x)} ${n(m.y)}Z" fill="${color}"/>`;
    }
    default: return `<path d="M${n(a.x)} ${n(a.y)}L${n(tip.x)} ${n(tip.y)}L${n(b.x)} ${n(b.y)}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

/** Gekürzter Endpunkt, damit die Linie nicht über eine gefüllte Spitze hinausragt. */
function trim(head: Head, from: Vec, tip: Vec, width: number): Vec {
  if (head !== "filled" && head !== "vector") return tip;
  const L = Math.max(8, width * 4.5) * (head === "vector" ? 0.6 : 0.9);
  const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  return { x: tip.x - ((tip.x - from.x) / d) * L, y: tip.y - ((tip.y - from.y) / d) * L };
}

function bounds(pts: Vec[], pad: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

function renderLine(s: LineSpec): Rendered {
  const pad = Math.max(10, s.width * 5);
  const b = bounds(s.pts, pad);
  const p = s.pts.map((q) => ({ x: q.x - b.x, y: q.y - b.y }));
  const k = p.length;
  const first = k > 1 && !s.closed ? trim(s.head0, p[1], p[0], s.width) : p[0];
  const last = k > 1 && !s.closed ? trim(s.head1, p[k - 2], p[k - 1], s.width) : p[k - 1];
  const pts = [first, ...p.slice(1, -1), last];
  const d = pts.map((q, i) => `${i ? "L" : "M"}${n(q.x)} ${n(q.y)}`).join("") + (s.closed ? "Z" : "");
  let body = `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${n(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (k > 1 && !s.closed) body += headSvg(s.head0, p[1], p[0], s.color, s.width) + headSvg(s.head1, p[k - 2], p[k - 1], s.color, s.width);
  return { svg: svgDoc(b.w, b.h, body), w: b.w, h: b.h, ox: -b.x, oy: -b.y };
}

const fmtNum = (v: number) => (Math.abs(v) < 1e-9 ? "0" : String(Math.round(v * 1000) / 1000).replace(".", ","));

function renderCoord(s: CoordSpec): Rendered {
  const u = s.unit, pad = 28;
  const W = (s.xmax - s.xmin) * u, H = (s.ymax - s.ymin) * u;
  const X = (v: number) => pad + (v - s.xmin) * u, Y = (v: number) => pad + (s.ymax - v) * u;
  const c = s.color, fs = Math.max(9, Math.min(14, u * 0.55));
  let body = "";
  if (s.grid) {
    let g = "";
    for (let v = Math.ceil(s.xmin / s.step) * s.step; v <= s.xmax + 1e-9; v += s.step) g += `M${n(X(v))} ${n(pad)}V${n(pad + H)}`;
    for (let v = Math.ceil(s.ymin / s.step) * s.step; v <= s.ymax + 1e-9; v += s.step) g += `M${n(pad)} ${n(Y(v))}H${n(pad + W)}`;
    body += `<path d="${g}" stroke="${c}" stroke-opacity="0.25" stroke-width="0.6" fill="none"/>`;
  }
  const ax = Math.min(Math.max(0, s.ymin), s.ymax), ay = Math.min(Math.max(0, s.xmin), s.xmax);
  const lw = 1.4;
  body += renderLineBody({ x: X(s.xmin) - 6, y: Y(ax) }, { x: X(s.xmax) + 14, y: Y(ax) }, c, lw);
  body += renderLineBody({ x: X(ay), y: Y(s.ymin) + 6 }, { x: X(ay), y: Y(s.ymax) - 14 }, c, lw);
  let ticks = "", labels = "";
  for (let v = Math.ceil(s.xmin / s.step) * s.step; v <= s.xmax + 1e-9; v += s.step) {
    if (Math.abs(v - ay) < 1e-9) continue;
    ticks += `M${n(X(v))} ${n(Y(ax) - 3)}v6`;
    if (s.labels) labels += `<text x="${n(X(v))}" y="${n(Y(ax) + fs + 3)}" text-anchor="middle" font-size="${n(fs)}" ${FONT} fill="${c}">${fmtNum(v)}</text>`;
  }
  for (let v = Math.ceil(s.ymin / s.step) * s.step; v <= s.ymax + 1e-9; v += s.step) {
    if (Math.abs(v - ax) < 1e-9) continue;
    ticks += `M${n(X(ay) - 3)} ${n(Y(v))}h6`;
    if (s.labels) labels += `<text x="${n(X(ay) - 6)}" y="${n(Y(v) + fs / 3)}" text-anchor="end" font-size="${n(fs)}" ${FONT} fill="${c}">${fmtNum(v)}</text>`;
  }
  body += `<path d="${ticks}" stroke="${c}" stroke-width="1" fill="none"/>` + labels;
  body += `<text x="${n(X(s.xmax) + 14)}" y="${n(Y(ax) - 6)}" text-anchor="end" font-size="${n(fs + 1)}" font-style="italic" ${FONT} fill="${c}">${esc(s.xLabel)}</text>`;
  body += `<text x="${n(X(ay) + 8)}" y="${n(Y(s.ymax) - 4)}" font-size="${n(fs + 1)}" font-style="italic" ${FONT} fill="${c}">${esc(s.yLabel)}</text>`;
  const w = W + 2 * pad, h = H + 2 * pad;
  return { svg: svgDoc(w, h, body), w, h, ox: 0, oy: 0 };
}

function renderLineBody(a: Vec, b: Vec, c: string, lw: number) {
  const t = trim("filled", a, b, lw);
  return `<path d="M${n(a.x)} ${n(a.y)}L${n(t.x)} ${n(t.y)}" stroke="${c}" stroke-width="${lw}" fill="none"/>` + headSvg("filled", a, b, c, lw);
}

function renderNumberLine(s: NumberLineSpec): Rendered {
  const u = s.unit, pad = 20, L = (s.max - s.min) * u, h = 52, y = 22, c = s.color;
  const X = (v: number) => pad + (v - s.min) * u;
  let body = renderLineBody({ x: pad - 8, y }, { x: X(s.max) + 18, y }, c, 1.4), ticks = "";
  const fs = Math.max(9, Math.min(14, u * 0.55));
  for (let v = Math.ceil(s.min / s.step) * s.step; v <= s.max + 1e-9; v += s.step) {
    const big = Math.abs(v) < 1e-9;
    ticks += `M${n(X(v))} ${y - (big ? 7 : 5)}v${big ? 14 : 10}`;
    if (s.labels) body += `<text x="${n(X(v))}" y="${y + fs + 8}" text-anchor="middle" font-size="${n(fs)}" ${FONT} fill="${c}">${fmtNum(v)}</text>`;
  }
  body += `<path d="${ticks}" stroke="${c}" stroke-width="1.1" fill="none"/>`;
  const w = L + 2 * pad + 18;
  return { svg: svgDoc(w, h, body), w, h, ox: 0, oy: 0 };
}

/** Schaltzeichen nach DIN EN 60617, Breite 80, Höhe 40, Anschlüsse links/rechts auf halber Höhe. */
function symbolBody(name: SymbolName, c: string): string {
  const st = `stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"`;
  const wire = (x0: number, x1: number) => `<path d="M0 20H${x0}M${x1} 20H80" ${st}/>`;
  const circle = (label: string) => wire(24, 56) + `<circle cx="40" cy="20" r="16" ${st}/><text x="40" y="26" text-anchor="middle" font-size="17" ${FONT} fill="${c}">${label}</text>`;
  switch (name) {
    case "resistor": return wire(20, 60) + `<rect x="20" y="12" width="40" height="16" ${st}/>`;
    case "lamp": return wire(26, 54) + `<circle cx="40" cy="20" r="14" ${st}/><path d="M30 10L50 30M50 10L30 30" ${st}/>`;
    case "battery": return wire(36, 44) + `<path d="M36 6V34" ${st}/><path d="M44 12V28" stroke="${c}" stroke-width="5"/>`;
    case "switch": return `<path d="M0 20H24M56 20H80M26 20L54 8" ${st}/><circle cx="25" cy="20" r="2" fill="${c}"/><circle cx="55" cy="20" r="2" fill="${c}"/>`;
    case "voltmeter": return circle("V");
    case "ammeter": return circle("A");
    case "diode": return wire(30, 50) + `<path d="M30 8L50 20L30 32Z" fill="${c}"/><path d="M50 8V32" ${st}/>`;
    case "capacitor": return wire(36, 44) + `<path d="M36 6V34M44 6V34" ${st}/>`;
  }
}

function labBody(name: LabName, c: string): { body: string; w: number; h: number } {
  const st = `stroke="${c}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"`;
  switch (name) {
    case "beaker": return { w: 70, h: 84, body: `<path d="M6 4H14V76Q14 80 18 80H52Q56 80 56 76V4H62" ${st}/><path d="M20 30H30M20 46H30M20 62H30" ${st} stroke-width="1"/>` };
    case "erlenmeyer": return { w: 80, h: 96, body: `<path d="M30 4H50M33 4V34L6 86Q4 92 10 92H70Q76 92 74 86L47 34V4" ${st}/>` };
    case "testtube": return { w: 30, h: 100, body: `<path d="M4 4H26M7 4V84A8 8 0 0 0 23 84V4" ${st}/>` };
    case "bunsen": return { w: 64, h: 110, body: `<path d="M24 30H40V96H24Z" ${st}/><path d="M8 96H56V104H8Z" ${st}/><path d="M32 4Q22 16 28 26H36Q42 16 32 4Z" stroke="${c}" stroke-width="1.5" fill="none"/><path d="M40 80H54" ${st}/>` };
  }
}

function renderStaff(s: StaffSpec): Rendered {
  const g = s.gap, pad = 8, h = g * 4 + 2 * pad + g * 2, w = s.length;
  let d = "";
  for (let i = 0; i < 5; i++) d += `M0 ${n(pad + g + i * g)}H${n(w)}`;
  let body = `<path d="${d}" stroke="${s.color}" stroke-width="1" fill="none"/><path d="M0.5 ${n(pad + g)}V${n(pad + 5 * g)}M${n(w - 0.5)} ${n(pad + g)}V${n(pad + 5 * g)}" stroke="${s.color}" stroke-width="1"/>`;
  if (s.clef) body += `<text x="${n(g * 0.3)}" y="${n(pad + g * 4.7)}" font-size="${n(g * 6.2)}" font-family="Segoe UI Symbol, Noto Music, serif" fill="${s.color}">𝄞</text>`;
  return { svg: svgDoc(w, h, body), w, h, ox: 0, oy: 0 };
}

function renderBond(s: BondSpec): Rendered {
  const h = 24, w = s.length, gap = 6;
  const ys = s.order === 1 ? [12] : s.order === 2 ? [12 - gap / 2, 12 + gap / 2] : [12 - gap, 12, 12 + gap];
  const d = ys.map((y) => `M2 ${y}H${w - 2}`).join("");
  return { svg: svgDoc(w, h, `<path d="${d}" stroke="${s.color}" stroke-width="2" stroke-linecap="round"/>`), w, h, ox: 0, oy: 0 };
}

/** Winkel in Grad (0–180) zwischen BA und BC. */
export function angleDeg(a: Vec, b: Vec, c: Vec): number {
  const u = Math.atan2(a.y - b.y, a.x - b.x), v = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(u - v);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

export const fmtDeg = (d: number) => `${(Math.round(d * 10) / 10).toString().replace(".", ",")}°`;

function renderAngle(s: AngleSpec): Rendered {
  const r = 28, pad = 46;
  const b0 = bounds([s.b, ...[s.a, s.c].map((p) => towards(s.b, p, r + 30))], pad);
  const B = { x: s.b.x - b0.x, y: s.b.y - b0.y };
  const ua = Math.atan2(s.a.y - s.b.y, s.a.x - s.b.x), uc = Math.atan2(s.c.y - s.b.y, s.c.x - s.b.x);
  let da = uc - ua;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const deg = angleDeg(s.a, s.b, s.c);
  const p0 = { x: B.x + Math.cos(ua) * r, y: B.y + Math.sin(ua) * r }, p1 = { x: B.x + Math.cos(uc) * r, y: B.y + Math.sin(uc) * r };
  const mid = ua + da / 2;
  let body: string;
  if (Math.abs(deg - 90) < 0.5) {
    // rechter Winkel: Quadrat mit Punkt
    const q = r * 0.6, e1 = { x: Math.cos(ua) * q, y: Math.sin(ua) * q }, e2 = { x: Math.cos(uc) * q, y: Math.sin(uc) * q };
    body = `<path d="M${n(B.x + e1.x)} ${n(B.y + e1.y)}L${n(B.x + e1.x + e2.x)} ${n(B.y + e1.y + e2.y)}L${n(B.x + e2.x)} ${n(B.y + e2.y)}" stroke="${s.color}" stroke-width="1.5" fill="none"/>` +
      `<circle cx="${n(B.x + (e1.x + e2.x) / 2)}" cy="${n(B.y + (e1.y + e2.y) / 2)}" r="1.8" fill="${s.color}"/>`;
  } else {
    body = `<path d="M${n(p0.x)} ${n(p0.y)}A${r} ${r} 0 0 ${da > 0 ? 1 : 0} ${n(p1.x)} ${n(p1.y)}" stroke="${s.color}" stroke-width="1.5" fill="none"/>`;
  }
  const lx = B.x + Math.cos(mid) * (r + 18), ly = B.y + Math.sin(mid) * (r + 18) + 5;
  body += `<text x="${n(lx)}" y="${n(ly)}" text-anchor="middle" font-size="14" ${FONT} fill="${s.color}">${fmtDeg(deg)}</text>`;
  return { svg: svgDoc(b0.w, b0.h, body), w: b0.w, h: b0.h, ox: -b0.x, oy: -b0.y };
}

function towards(from: Vec, to: Vec, d: number): Vec {
  const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / l) * d, y: from.y + ((to.y - from.y) / l) * d };
}

export function renderVec(s: VecSpec): Rendered {
  switch (s.t) {
    case "line": return renderLine(s);
    case "coord": return renderCoord(s);
    case "numberline": return renderNumberLine(s);
    case "symbol": return { svg: svgDoc(80, 40, symbolBody(s.name, s.color)), w: 80, h: 40, ox: 0, oy: 0, terminals: [{ x: 0, y: 20 }, { x: 80, y: 20 }] };
    case "lab": { const r = labBody(s.name, s.color); return { svg: svgDoc(r.w, r.h, r.body), w: r.w, h: r.h, ox: 0, oy: 0 }; }
    case "staff": return renderStaff(s);
    case "bond": return renderBond(s);
    case "angle": return renderAngle(s);
    case "fill": throw new Error("Füllungen sind Rasterbilder");
  }
}

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Standardvorlagen. `grid` = Karo-/Linienabstand des Blatts in Welteinheiten. */
export function defaultCoord(grid = 5 * MM, color = "#111827"): CoordSpec {
  return { t: "coord", xmin: -5, xmax: 5, ymin: -5, ymax: 5, unit: grid * 2, step: 1, grid: false, labels: true, xLabel: "x", yLabel: "y", color };
}
export function defaultNumberLine(grid = 5 * MM, color = "#111827"): NumberLineSpec {
  return { t: "numberline", min: -5, max: 5, step: 1, unit: grid * 2, labels: true, color };
}
export const defaultStaff = (color = "#111827"): StaffSpec => ({ t: "staff", length: 160 * MM, gap: 2 * MM, clef: true, color });
