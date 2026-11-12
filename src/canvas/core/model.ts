import type { BBox } from "@/lib/types";

/** Punkte: x, y, Druck, Neigung (Grad), t (ms seit Strichbeginn) – SPEC §3. */
export const PSTRIDE = 5;

export type PenKind = "fountain" | "ballpoint" | "pencil" | "highlighter";
export const PEN_KINDS: PenKind[] = ["fountain", "ballpoint", "pencil", "highlighter"];

export interface Stroke {
  id: string;
  pen: PenKind;
  /** Originalfarbe (#rrggbb) – im Dunkelmodus wird nur die Darstellung invertiert. */
  color: string;
  width: number;
  opacity: number;
  /** true = echter Stiftdruck, sonst simuliert. */
  pressure: boolean;
  points: Float32Array;
  bbox: BBox;
  z: number;
  /** Gecachter Umriss in Weltkoordinaten. */
  path?: Path2D;
}

export const pointCount = (s: { points: Float32Array }) => s.points.length / PSTRIDE;

export function computeBBox(points: Float32Array, width: number): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < points.length; i += PSTRIDE) {
    const x = points[i], y = points[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = width; // großzügig, Druck kann Breite erhöhen
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/** Neuer Strich; ein evtl. mitkopierter Umriss-Cache (`path`) wird verworfen. */
export function makeStroke(p: Omit<Stroke, "bbox" | "path"> & { bbox?: unknown; path?: unknown }): Stroke {
  const { id, pen, color, width, opacity, pressure, points, z } = p;
  return { id, pen, color, width, opacity, pressure, points, z, bbox: computeBBox(points, width) };
}

export const intersects = (a: BBox, b: BBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const uid = () => crypto.randomUUID();
