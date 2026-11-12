import { PSTRIDE, computeBBox, makeStroke, uid, type Stroke } from "./model";

export interface Vec { x: number; y: number }

/** Affine Matrix [a, b, c, d, e, f] wie DOMMatrix: x' = a·x + c·y + e. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const apply = (m: Mat, x: number, y: number): Vec => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
export const isIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/** Verschieben t, Drehen θ und gleichmäßig Skalieren s um Pivot c. */
export function similarity(c: Vec, tx: number, ty: number, theta: number, s: number): Mat {
  const cos = Math.cos(theta) * s, sin = Math.sin(theta) * s;
  return [cos, sin, -sin, cos, c.x + tx - (cos * c.x - sin * c.y), c.y + ty - (sin * c.x + cos * c.y)];
}

export function transformStroke(s: Stroke, m: Mat, keepId = true): Stroke {
  const p = new Float32Array(s.points);
  for (let i = 0; i < p.length; i += PSTRIDE) {
    const x = p[i], y = p[i + 1];
    p[i] = m[0] * x + m[2] * y + m[4];
    p[i + 1] = m[1] * x + m[3] * y + m[5];
  }
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return makeStroke({ ...s, id: keepId ? s.id : uid(), points: p, width: s.width * scale });
}

export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}

/** Trifft ein Kreis (x, y, r) den Strich? */
export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const b = s.bbox;
  if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) return false;
  const p = s.points;
  const rr = (r + s.width / 2) ** 2;
  if (p.length === PSTRIDE) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= rr;
  for (let i = PSTRIDE; i < p.length; i += PSTRIDE) {
    if (distToSegmentSq(x, y, p[i - PSTRIDE], p[i - PSTRIDE + 1], p[i], p[i + 1]) <= rr) return true;
  }
  return false;
}

/**
 * Partielles Radieren: entfernt alles innerhalb des Kreises und liefert die
 * verbleibenden Teilstücke (mit interpolierten Randpunkten). `null` = nicht getroffen.
 */
export function eraseFromStroke(s: Stroke, cx: number, cy: number, r: number): Stroke[] | null {
  if (!hitStroke(s, cx, cy, r)) return null;
  const rr = (r + s.width / 2) ** 2;
  const p = s.points;
  const n = p.length / PSTRIDE;
  const pieces: number[][] = [];
  let cur: number[] = [];
  const inside = (i: number) => (p[i * PSTRIDE] - cx) ** 2 + (p[i * PSTRIDE + 1] - cy) ** 2 <= rr;
  const lerpPush = (arr: number[], i: number, j: number, t: number) => {
    for (let k = 0; k < PSTRIDE; k++) arr.push(p[i * PSTRIDE + k] + (p[j * PSTRIDE + k] - p[i * PSTRIDE + k]) * t);
  };
  const flush = () => {
    if (cur.length >= 2 * PSTRIDE) pieces.push(cur);
    cur = [];
  };
  for (let i = 0; i < n; i++) {
    const inI = inside(i);
    if (i > 0) {
      // Schnittpunkte des Segments (i-1 → i) mit dem Kreis
      const ax = p[(i - 1) * PSTRIDE], ay = p[(i - 1) * PSTRIDE + 1];
      const dx = p[i * PSTRIDE] - ax, dy = p[i * PSTRIDE + 1] - ay;
      const fx = ax - cx, fy = ay - cy;
      const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - rr;
      const disc = B * B - 4 * A * C;
      if (A > 0 && disc > 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A);
        if (t1 > 0 && t1 < 1) {
          lerpPush(cur, i - 1, i, t1);
          flush();
        }
        if (t2 > 0 && t2 < 1) lerpPush(cur, i - 1, i, t2);
      }
    }
    if (inI) flush();
    else for (let k = 0; k < PSTRIDE; k++) cur.push(p[i * PSTRIDE + k]);
  }
  flush();
  return pieces.map((arr) => makeStroke({ ...s, id: uid(), points: Float32Array.from(arr) }));
}

export function pointInPolygon(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Lasso: Strich gilt als ausgewählt, wenn ≥ 60 % seiner Punkte im Polygon liegen. */
export function strokeInLasso(s: Stroke, poly: ArrayLike<number>): boolean {
  const p = s.points;
  const n = p.length / PSTRIDE;
  if (n === 0 || poly.length < 6) return false;
  let hits = 0;
  for (let i = 0; i < p.length; i += PSTRIDE) if (pointInPolygon(p[i], p[i + 1], poly)) hits++;
  return hits / n >= 0.6;
}

export function unionBBox(strokes: Stroke[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const b = computeBBox(s.points, s.width / 2);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
