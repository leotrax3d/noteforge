import type { Vec } from "../core/geometry";

/** Freihand → Form (SPEC §4). Reine Geometrie, ohne DOM. */
export type ShapeKind = "line" | "arrow" | "circle" | "ellipse" | "rectangle" | "triangle" | "polygon";

export interface Shape {
  kind: ShapeKind;
  /** Ideale Polylinie (geschlossene Formen: erster Punkt = letzter Punkt). */
  points: Vec[];
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  line: "Linie", arrow: "Pfeil", circle: "Kreis", ellipse: "Ellipse",
  rectangle: "Rechteck", triangle: "Dreieck", polygon: "Vieleck",
};

const DEG = Math.PI / 180;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(p: Vec[]) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]);
  return l;
}

function segDist(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Ramer-Douglas-Peucker. */
export function simplify(p: Vec[], tol: number): Vec[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(p[i], p[a], p[b]);
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

/** Winkel auf 0/45/90° … einrasten, wenn nahe dran. */
function snapAngle(a: Vec, b: Vec, tolDeg = 6): Vec {
  const len = dist(a, b);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const step = 45 * DEG;
  const near = Math.round(ang / step) * step;
  if (Math.abs(ang - near) > tolDeg * DEG) return b;
  return { x: a.x + Math.cos(near) * len, y: a.y + Math.sin(near) * len };
}

/** Polylinie gleichmäßig verdichten (für partielles Radieren / Druckverlauf). */
export function densify(p: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (p.length) out.push(p[p.length - 1]);
  return out;
}

function ellipsePoints(c: Vec, a: number, b: number, rot: number, n = 72): Vec[] {
  const out: Vec[] = [];
  const cos = Math.cos(rot), sin = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * a, y = Math.sin(t) * b;
    out.push({ x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos });
  }
  return out;
}

function arrowHead(tail: Vec, tip: Vec): Vec[] {
  const len = dist(tail, tip);
  const h = Math.min(len * 0.3, Math.max(10, len * 0.18));
  const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const l = { x: tip.x - Math.cos(ang - 28 * DEG) * h, y: tip.y - Math.sin(ang - 28 * DEG) * h };
  const r = { x: tip.x - Math.cos(ang + 28 * DEG) * h, y: tip.y - Math.sin(ang + 28 * DEG) * h };
  return [tail, tip, l, tip, r];
}

/** Innenwinkel an b (Grad). */
function cornerAngle(a: Vec, b: Vec, c: Vec) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d))) / DEG;
}

/** Ellipsen-Anpassung über Kovarianz (Hauptachsen) + Restfehler des normierten Radius. */
function fitEllipse(p: Vec[]) {
  // Gleichmäßig nach Bogenlänge abtasten, damit langsame Stellen nicht überwiegen.
  const q = densify(p, Math.max(1, pathLength(p) / 120));
  let cx = 0, cy = 0;
  for (const v of q) { cx += v.x; cy += v.y; }
  cx /= q.length; cy /= q.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const v of q) {
    const dx = v.x - cx, dy = v.y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= q.length; syy /= q.length; sxy /= q.length;
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = (sxx + syy) / 2, det = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const a = Math.sqrt(2 * (tr + det)), b = Math.sqrt(Math.max(1e-9, 2 * (tr - det)));
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let err = 0;
  for (const v of q) {
    const dx = v.x - cx, dy = v.y - cy;
    const u = dx * cos + dy * sin, w = -dx * sin + dy * cos;
    const r = Math.hypot(u / a, w / b);
    err += (r - 1) ** 2;
  }
  return { c: { x: cx, y: cy }, a, b, rot, err: Math.sqrt(err / q.length) };
}

/**
 * Erkennt eine Form in einem Freihandstrich. Liefert null, wenn der Strich
 * zu klein oder zu unregelmäßig ist (dann bleibt er Freihand).
 */
export function recognize(input: Vec[]): Shape | null {
  const pts = input.filter((v, i) => i === 0 || dist(v, input[i - 1]) > 0.01);
  if (pts.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of pts) {
    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y);
    x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 8) return null;
  const len = pathLength(pts);
  const first = pts[0], last = pts[pts.length - 1];
  const gap = dist(first, last);
  const closed = gap < Math.max(12, diag * 0.22) && len > diag * 1.6;

  if (!closed) {
    if (dist(first, last) / len > 0.93) {
      return { kind: "line", points: [first, snapAngle(first, last)] };
    }
    const s = simplify(pts, diag * 0.07);
    // Schaft + eine Spitze (A→B→C) oder Schaft + beide Spitzen (A→B→C→B'→D)
    if (s.length >= 3 && s.length <= 6) {
      const shaft = dist(s[0], s[1]);
      const rest = s.slice(1);
      const headLen = pathLength(rest);
      const backToTip = rest.every((v, i) => i % 2 === 1 || dist(v, s[1]) < shaft * 0.15);
      if (shaft > diag * 0.6 && headLen < shaft * 1.1 && backToTip && cornerAngle(s[0], s[1], s[2]) < 70) {
        const tip = s[1];
        return { kind: "arrow", points: arrowHead(s[0], snapAngle(s[0], tip)) };
      }
    }
    return null;
  }

  // Geschlossen: Polygon oder Ellipse
  const loop = [...pts, first];
  const el = fitEllipse(loop);
  let poly = simplify(loop, diag * 0.08);
  if (poly.length > 2 && dist(poly[0], poly[poly.length - 1]) < diag * 0.15) poly = poly.slice(0, -1);
  // Startpunkt liegt oft mitten auf einer Kante → fast gerade Ecken entfernen
  poly = poly.filter((v, i) => cornerAngle(poly[(i - 1 + poly.length) % poly.length], v, poly[(i + 1) % poly.length]) < 160);
  const k = poly.length;

  // Restfehler des Polygons (normiert wie der Ellipsenfehler) – Sechsecke sind fast rund.
  let polyErr = Infinity;
  if (k >= 3 && k <= 10) {
    const q = densify(loop, Math.max(1, len / 120));
    let e = 0;
    for (const v of q) {
      let m = Infinity;
      for (let i = 0; i < k; i++) m = Math.min(m, segDist(v, poly[i], poly[(i + 1) % k]));
      e += m * m;
    }
    polyErr = Math.sqrt(e / q.length) / ((el.a + el.b) / 2);
  }
  const ellipseLike = el.err < 0.1 && polyErr > el.err * 0.5 && (k > 4 || el.err < 0.06);
  if (ellipseLike) {
    if (el.b / el.a > 0.82) {
      const r = (el.a + el.b) / 2;
      return { kind: "circle", points: ellipsePoints(el.c, r, r, 0) };
    }
    let rot = el.rot;
    const nearAxis = Math.round(rot / (90 * DEG)) * 90 * DEG;
    if (Math.abs(rot - nearAxis) < 8 * DEG) rot = nearAxis;
    return { kind: "ellipse", points: ellipsePoints(el.c, el.a, el.b, rot) };
  }
  if (k === 3) return { kind: "triangle", points: [...poly, poly[0]] };
  if (k === 4) {
    const angles = poly.map((v, i) => cornerAngle(poly[(i + 3) % 4], v, poly[(i + 1) % 4]));
    if (angles.every((a) => Math.abs(a - 90) < 22)) return { kind: "rectangle", points: rectFrom(poly) };
    return { kind: "polygon", points: [...poly, poly[0]] };
  }
  if (k >= 5 && k <= 10) return { kind: "polygon", points: [...poly, poly[0]] };
  return null;
}

/** Rechteck aus vier Ecken: Ausrichtung an der längsten Kante, achsparallel einrasten. */
function rectFrom(q: Vec[]): Vec[] {
  let best = 0, bi = 0;
  for (let i = 0; i < 4; i++) {
    const l = dist(q[i], q[(i + 1) % 4]);
    if (l > best) { best = l; bi = i; }
  }
  let ang = Math.atan2(q[(bi + 1) % 4].y - q[bi].y, q[(bi + 1) % 4].x - q[bi].x);
  const near = Math.round(ang / (90 * DEG)) * 90 * DEG;
  if (Math.abs(ang - near) < 8 * DEG) ang = near;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of q) {
    const u = p.x * cos + p.y * sin, v = -p.x * sin + p.y * cos;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const back = (u: number, v: number) => ({ x: u * cos - v * sin, y: u * sin + v * cos });
  const c = [back(u0, v0), back(u1, v0), back(u1, v1), back(u0, v1)];
  return [...c, c[0]];
}
