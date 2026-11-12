import { getStroke, type StrokeOptions } from "perfect-freehand";
import { PSTRIDE, type PenKind, type Stroke } from "./model";
import { invertLightness } from "./color";

export interface PenDef {
  label: string;
  opacity: number;
  widths: number[];
  defaultWidth: number;
  options: (pressure: boolean) => StrokeOptions;
}

export const PENS: Record<PenKind, PenDef> = {
  fountain: {
    label: "Füller",
    opacity: 1,
    widths: [1.5, 2.5, 4, 6, 9],
    defaultWidth: 2.5,
    options: (pressure) => ({ thinning: 0.65, smoothing: 0.55, streamline: 0.4, simulatePressure: !pressure }),
  },
  ballpoint: {
    label: "Kugelschreiber",
    opacity: 1,
    widths: [1, 1.5, 2, 3, 5],
    defaultWidth: 2,
    options: () => ({ thinning: 0, smoothing: 0.5, streamline: 0.45, simulatePressure: false }),
  },
  pencil: {
    label: "Bleistift",
    opacity: 0.85,
    widths: [1, 1.5, 2.5, 4, 6],
    defaultWidth: 1.5,
    options: (pressure) => ({ thinning: 0.35, smoothing: 0.5, streamline: 0.35, simulatePressure: !pressure }),
  },
  highlighter: {
    label: "Textmarker",
    opacity: 0.38,
    widths: [8, 12, 18, 26, 36],
    defaultWidth: 18,
    options: () => ({
      thinning: 0,
      smoothing: 0.6,
      streamline: 0.5,
      simulatePressure: false,
      start: { cap: false },
      end: { cap: false },
    }),
  },
};

/** Punkte im Format für perfect-freehand. */
export function toFreehand(points: Float32Array, count = points.length / PSTRIDE, constant = false): number[][] {
  const out = new Array<number[]>(count);
  for (let k = 0; k < count; k++) {
    const i = k * PSTRIDE;
    out[k] = [points[i], points[i + 1], constant ? 0.5 : points[i + 2]];
  }
  return out;
}

export function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
  return path;
}

export function buildPath(pen: PenKind, width: number, pressure: boolean, pts: number[][], last: boolean): Path2D {
  const opts = PENS[pen].options(pressure);
  return outlinePath(getStroke(pts, { size: width, ...opts, last }));
}

export function strokePath(s: Stroke): Path2D {
  if (!s.path) s.path = buildPath(s.pen, s.width, s.pressure, toFreehand(s.points, undefined, s.pen === "ballpoint"), true);
  return s.path;
}

// ---- Bleistift-Textur: Rauschmuster je Farbe, einmal erzeugt ----
const grain = new Map<string, CanvasPattern | null>();

function pencilPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  let pat = grain.get(color);
  if (pat === undefined) {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const g = c.getContext("2d");
    pat = null;
    if (g) {
      g.fillStyle = color;
      let seed = 1234567;
      for (let y = 0; y < 48; y++)
        for (let x = 0; x < 48; x++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          g.globalAlpha = 0.35 + (seed / 0x7fffffff) * 0.65;
          g.fillRect(x, y, 1, 1);
        }
      pat = ctx.createPattern(c, "repeat");
      pat?.setTransform?.(new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
    }
    grain.set(color, pat);
  }
  return pat ?? color;
}

export function displayColor(color: string, dark: boolean) {
  return dark ? invertLightness(color) : color;
}

/** Zeichnet einen Strich im aktuellen Welt-Transform. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, dark: boolean, path = strokePath(s)) {
  const color = displayColor(s.color, dark);
  ctx.globalAlpha = s.opacity;
  ctx.globalCompositeOperation = s.pen === "highlighter" && !dark ? "multiply" : "source-over";
  ctx.fillStyle = s.pen === "pencil" ? pencilPattern(ctx, color) : color;
  ctx.fill(path);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
