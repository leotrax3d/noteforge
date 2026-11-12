import type { Vec } from "../core/geometry";
import { MM } from "../core/layout";

/** Zeichenhilfen als Overlays (SPEC §4): Lineal, Geodreieck, Zirkel. Weltkoordinaten. */
export type GuideKind = "ruler" | "setsquare" | "compass";

export interface Guide {
  kind: GuideKind;
  /** Ankerpunkt: Mitte (Lineal), Mitte der Hypotenuse (Geodreieck), Einstich (Zirkel). */
  x: number;
  y: number;
  /** Drehung in Radiant. */
  angle: number;
  /** Nur Zirkel: Radius in Welteinheiten. */
  r: number;
}

export const GUIDE_LABELS: Record<GuideKind, string> = { ruler: "Lineal", setsquare: "Geodreieck", compass: "Zirkel" };

export const RULER_LEN = 300 * MM;
export const RULER_W = 40 * MM;
export const SQ_HYP = 160 * MM;
const DEG = Math.PI / 180;

export function makeGuide(kind: GuideKind, at: Vec): Guide {
  return { kind, x: at.x, y: at.y, angle: 0, r: 40 * MM };
}

export function toLocal(g: Guide, p: Vec): Vec {
  const dx = p.x - g.x, dy = p.y - g.y, c = Math.cos(g.angle), s = Math.sin(g.angle);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

export function fromLocal(g: Guide, u: number, v: number): Vec {
  const c = Math.cos(g.angle), s = Math.sin(g.angle);
  return { x: g.x + u * c - v * s, y: g.y + u * s + v * c };
}

/** Kanten zum Anlegen (lokale Koordinaten). */
function localEdges(g: Guide): [Vec, Vec][] {
  if (g.kind === "ruler") {
    const l = RULER_LEN / 2, w = RULER_W / 2;
    return [[{ x: -l, y: -w }, { x: l, y: -w }], [{ x: -l, y: w }, { x: l, y: w }]];
  }
  if (g.kind === "setsquare") {
    const h = SQ_HYP / 2;
    return [[{ x: -h, y: 0 }, { x: h, y: 0 }], [{ x: -h, y: 0 }, { x: 0, y: h }], [{ x: h, y: 0 }, { x: 0, y: h }]];
  }
  return [];
}

/** Umriss in lokalen Koordinaten. */
function outline(g: Guide): Vec[] {
  if (g.kind === "ruler") {
    const l = RULER_LEN / 2, w = RULER_W / 2;
    return [{ x: -l, y: -w }, { x: l, y: -w }, { x: l, y: w }, { x: -l, y: w }];
  }
  const h = SQ_HYP / 2;
  return [{ x: -h, y: 0 }, { x: h, y: 0 }, { x: 0, y: h }];
}

function inConvex(poly: Vec[], p: Vec) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
  }
  return true;
}

/** Liegt p (Welt) auf der Zeichenhilfe? `tol` erweitert den Rand (Welteinheiten). */
export function hitGuide(g: Guide, p: Vec, tol = 0): boolean {
  const q = toLocal(g, p);
  if (g.kind === "compass") return Math.hypot(q.x, q.y) <= Math.max(tol, 22);
  if (tol === 0) return inConvex(outline(g), q);
  return inConvex(outline(g), q) || nearestEdge(g, p, tol) !== null;
}

function project(a: Vec, b: Vec, p: Vec): { t: number; d: number; q: Vec } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  const tc = Math.max(0, Math.min(1, t));
  const q = { x: a.x + tc * dx, y: a.y + tc * dy };
  return { t, d: Math.hypot(p.x - q.x, p.y - q.y), q };
}

export interface EdgeSnap {
  edge: number;
  /** Seite der Kante, auf der der Stift begann (+1/-1) – Tinte bleibt außerhalb. */
  side: number;
}

/** Nächste Kante innerhalb tol (Welteinheiten), bevorzugt von außen angelegt. */
export function nearestEdge(g: Guide, p: Vec, tol: number): EdgeSnap | null {
  const q = toLocal(g, p);
  let best: EdgeSnap | null = null, bd = tol;
  localEdges(g).forEach(([a, b], i) => {
    const r = project(a, b, q);
    if (r.t < -0.02 || r.t > 1.02) return;
    if (r.d <= bd) {
      bd = r.d;
      const cross = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
      best = { edge: i, side: cross >= 0 ? 1 : -1 };
    }
  });
  return best;
}

/** Punkt (Welt) auf die Kante projizieren; die Linie verläuft genau auf der Kante. */
export function snapToEdge(g: Guide, snap: EdgeSnap, p: Vec): Vec {
  const [a, b] = localEdges(g)[snap.edge];
  const q = toLocal(g, p);
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2;
  return fromLocal(g, a.x + t * dx, a.y + t * dy);
}

/** Zirkel: Punkt auf den Kreis um den Einstich legen. */
export function snapToCircle(g: Guide, r: number, p: Vec): Vec {
  const a = Math.atan2(p.y - g.y, p.x - g.x);
  return { x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r };
}

/** Drehgriff (Welt) für Maus/Stift. */
export function rotateHandle(g: Guide): Vec {
  if (g.kind === "ruler") return fromLocal(g, RULER_LEN / 2 - 12 * MM, 0);
  if (g.kind === "setsquare") return fromLocal(g, 0, SQ_HYP / 2 - 16 * MM);
  return fromLocal(g, g.r, 0);
}

/** Drehung auf 15°-Schritte einrasten (±2°), sonst auf ganze Grad runden für die Anzeige. */
export function snapRotation(angle: number): number {
  const step = 15 * DEG;
  const near = Math.round(angle / step) * step;
  return Math.abs(angle - near) < 2 * DEG ? near : angle;
}

/** Anzeigewinkel 0–180° (gegen den Uhrzeigersinn, wie im Matheunterricht). */
export function displayAngle(angle: number): number {
  let d = Math.round(-angle / DEG) % 180;
  if (d < 0) d += 180;
  return d;
}

const fmt = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

export interface GuideDrawState {
  /** Gerätepixel pro Welteinheit. */
  k: number;
  dark: boolean;
  /** Aktive Kante (wird beim Anlegen hervorgehoben). */
  edge?: number;
  /** Zusatzinfo während des Zeichnens (z. B. Länge, Radius). */
  label?: string;
}

/** Zeichnet die Zeichenhilfe; ctx steht im Welt-Transform. */
export function drawGuide(ctx: CanvasRenderingContext2D, g: Guide, st: GuideDrawState) {
  const px = 1 / st.k; // 1 Gerätepixel
  const ink = st.dark ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.85)";
  const fill = st.dark ? "rgba(40,48,64,0.55)" : "rgba(214,230,255,0.55)";
  const accent = "#3b82f6";
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.angle);
  ctx.lineWidth = px * 1.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  const font = (sizePx: number) => `${sizePx * px}px system-ui, sans-serif`;

  if (g.kind === "compass") {
    drawCompass(ctx, g, st, px, ink, accent, font);
    ctx.restore();
    return;
  }

  const poly = outline(g);
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;

  const edges = localEdges(g);
  if (st.edge !== undefined && edges[st.edge]) {
    const [a, b] = edges[st.edge];
    ctx.strokeStyle = accent;
    ctx.lineWidth = px * 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = px * 1.5;
  }

  const showMm = st.k * MM > 3; // mm-Striche nur, wenn sie > 3 Gerätepixel auseinander liegen
  ctx.lineWidth = px;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = font(11);

  if (g.kind === "ruler") {
    const l = RULER_LEN / 2, w = RULER_W / 2;
    for (let mm = 0; mm <= 300; mm++) {
      if (!showMm && mm % 5) continue;
      const x = -l + mm * MM;
      const len = mm % 10 === 0 ? 7 * MM : mm % 5 === 0 ? 4.5 * MM : 2.5 * MM;
      ctx.beginPath();
      ctx.moveTo(x, -w);
      ctx.lineTo(x, -w + len);
      ctx.moveTo(x, w);
      ctx.lineTo(x, w - len);
      ctx.stroke();
      if (mm % 10 === 0 && st.k * MM * 10 > 18) ctx.fillText(String(mm / 10), x, -w + 8 * MM);
    }
  } else {
    const h = SQ_HYP / 2;
    // mm-Skala auf der Hypotenuse, vom Mittelpunkt aus (wie beim echten Geodreieck)
    for (let mm = -80; mm <= 80; mm++) {
      if (!showMm && mm % 5) continue;
      const x = mm * MM;
      const len = mm % 10 === 0 ? 5 * MM : mm % 5 === 0 ? 3.5 * MM : 2 * MM;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, len);
      ctx.stroke();
      if (mm % 10 === 0 && mm !== 0 && st.k * MM * 10 > 18) ctx.fillText(String(Math.abs(mm / 10)), x, 6 * MM);
    }
    // Winkelskala (Halbkreis) 0–180°
    const R = h * 0.62;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI);
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.font = font(10);
    for (let d = 0; d <= 180; d++) {
      if (st.k * R * DEG < 2.5 && d % 5) continue;
      const a = d * DEG;
      const len = d % 10 === 0 ? 5 * MM : d % 5 === 0 ? 3 * MM : 1.6 * MM;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(c * R, s * R);
      ctx.lineTo(c * (R - len), s * (R - len));
      ctx.stroke();
      if (d % 10 === 0 && st.k * R * DEG * 10 > 16) ctx.fillText(String(180 - d), c * (R - 8 * MM), s * (R - 8 * MM));
    }
    // Mittelpunkt
    ctx.beginPath();
    ctx.moveTo(-3 * MM, 0);
    ctx.lineTo(3 * MM, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 4 * MM);
    ctx.stroke();
  }

  // Drehgriff
  const rh = toLocal(g, rotateHandle(g));
  ctx.beginPath();
  ctx.arc(rh.x, rh.y, 14 * px * (st.k > 0 ? 1 : 1), 0, Math.PI * 2);
  ctx.fillStyle = st.dark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = px * 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rh.x, rh.y, 7 * px, -Math.PI * 0.9, Math.PI * 0.4);
  ctx.stroke();

  // Winkelanzeige
  const labelPos = g.kind === "ruler" ? { x: 0, y: 0 } : { x: 0, y: SQ_HYP * 0.16 };
  const txt = `${displayAngle(g.angle)}°` + (st.label ? `  ·  ${st.label}` : "");
  badge(ctx, txt, labelPos, px, st.dark, -g.angle);
  ctx.restore();
}

function drawCompass(
  ctx: CanvasRenderingContext2D, g: Guide, st: GuideDrawState, px: number, ink: string, accent: string,
  font: (s: number) => string,
) {
  // Kreis-Vorschau
  ctx.setLineDash([6 * px, 6 * px]);
  ctx.strokeStyle = st.dark ? "rgba(255,255,255,0.35)" : "rgba(15,23,42,0.3)";
  ctx.beginPath();
  ctx.arc(0, 0, g.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Schenkel
  ctx.strokeStyle = ink;
  ctx.lineWidth = px * 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(g.r, 0);
  ctx.stroke();
  // Einstich (Griff ≥ 44 px)
  ctx.beginPath();
  ctx.arc(0, 0, 22 * px, 0, Math.PI * 2);
  ctx.fillStyle = st.dark ? "rgba(59,130,246,0.25)" : "rgba(59,130,246,0.15)";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = px * 1.5;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, 3 * px, 0, Math.PI * 2);
  ctx.fill();
  // Stiftspitze (Griff)
  ctx.beginPath();
  ctx.arc(g.r, 0, 14 * px, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.font = font(11);
  const txt = `r = ${fmt(g.r / MM / 10)} cm` + (st.label ? `  ·  ${st.label}` : "");
  badge(ctx, txt, { x: g.r / 2, y: -16 * px }, px, st.dark, -g.angle);
}

function badge(ctx: CanvasRenderingContext2D, text: string, at: Vec, px: number, dark: boolean, counterRot: number) {
  ctx.save();
  ctx.translate(at.x, at.y);
  // Text immer lesbar (nicht auf dem Kopf)
  const a = -counterRot;
  const norm = Math.atan2(Math.sin(a), Math.cos(a));
  if (Math.abs(norm) > Math.PI / 2) ctx.rotate(Math.PI);
  ctx.font = `600 ${12 * px}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 14 * px;
  ctx.fillStyle = dark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -11 * px, w, 22 * px, 11 * px);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = dark ? "#e2e8f0" : "#0f172a";
  ctx.fillText(text, 0, 0.5 * px);
  ctx.restore();
}

export { fmt as formatNumber };
