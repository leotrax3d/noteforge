import { getStroke, type StrokeOptions } from "perfect-freehand";

export interface StrokeStyle {
  color: string;
  size: number;
  /** true = Breite folgt dem Stiftdruck, sonst simuliert über Geschwindigkeit. */
  pressure: boolean;
}

export function strokeOptions(style: StrokeStyle, last: boolean): StrokeOptions {
  return {
    size: style.size,
    thinning: style.pressure ? 0.6 : 0.5,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: !style.pressure,
    last,
  };
}

/** Umrisspolygon → Path2D mit quadratischer Glättung. */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
  return path;
}

export function strokeOutline(points: number[][], style: StrokeStyle, last: boolean): number[][] {
  return getStroke(points, strokeOptions(style, last));
}
