// Füllwerkzeug (SPEC §4.3): geschlossenen Bereich um den Tipp-Punkt finden (Flutfüllung auf Raster),
// Lücken bis `gap` werden durch Verbreitern der Begrenzungen überbrückt.
import type { BBox } from "@/lib/types";
import type { Vec } from "../core/geometry";
import type { FillSpec } from "./vec";

export interface Region {
  /** Weltrechteck der Maske */
  rect: BBox;
  /** Pixel pro Welteinheit */
  res: number;
  /** 1 = gefüllt, Breite × Höhe */
  mask: Uint8Array;
  w: number;
  h: number;
}

/** Begrenzungen zeichnen (deckend) – Striche als Pfade, Vektor-Bilder als Bild. */
export type DrawWalls = (ctx: CanvasRenderingContext2D, grow: number) => void;

/**
 * Flutfüllung in einem Fenster `win` (Welt). Liefert null, wenn der Bereich offen ist (Rand erreicht).
 * Reine Rasterlogik, ausgelagert für Tests: `walls` = 1 für Wandpixel.
 */
export function floodRegion(walls: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array | null {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || walls[sy * w + sx]) return null;
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  stack[sp++] = sy * w + sx;
  out[sy * w + sx] = 1;
  while (sp) {
    const i = stack[--sp];
    const x = i % w, y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null; // offen
    const nb = [i - 1, i + 1, i - w, i + w];
    for (const j of nb) if (!out[j] && !walls[j]) { out[j] = 1; stack[sp++] = j; }
  }
  return out;
}

/** Maske um `r` Pixel verbreitern (damit die Füllung unter die Linie reicht). */
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let cur = m;
  for (let k = 0; k < r; k++) {
    const nx = cur.slice();
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!cur[i] && (cur[i - 1] || cur[i + 1] || cur[i - w] || cur[i + w])) nx[i] = 1;
      }
    cur = nx;
  }
  return cur;
}

const MAX_PX = 900;

export function findRegion(at: Vec, drawWalls: DrawWalls, gap: number, content: BBox | null): Region | null {
  for (const size of [600, 1600, 4000]) {
    let rect: BBox = { x: at.x - size / 2, y: at.y - size / 2, w: size, h: size };
    if (content) {
      // Fenster nicht größer als nötig (Inhalt + Rand)
      const x0 = Math.max(rect.x, content.x - 20), y0 = Math.max(rect.y, content.y - 20);
      const x1 = Math.min(rect.x + rect.w, content.x + content.w + 20), y1 = Math.min(rect.y + rect.h, content.y + content.h + 20);
      if (x1 > x0 && y1 > y0) rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const res = Math.min(2, MAX_PX / Math.max(rect.w, rect.h));
    const w = Math.max(8, Math.ceil(rect.w * res)), h = Math.max(8, Math.ceil(rect.h * res));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(res, 0, 0, res, -rect.x * res, -rect.y * res);
    drawWalls(ctx, gap);
    const px = ctx.getImageData(0, 0, w, h).data;
    const walls = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) walls[i] = px[i * 4 + 3] > 40 ? 1 : 0;
    const sx = Math.floor((at.x - rect.x) * res), sy = Math.floor((at.y - rect.y) * res);
    const m = floodRegion(walls, w, h, sx, sy);
    if (m) return { rect, res, mask: dilate(m, w, h, Math.max(1, Math.round((gap / 2) * res) + 1)), w, h };
    // Fenster umfasst schon den ganzen Inhalt → wirklich offen
    if (!content || (rect.x <= content.x && rect.y <= content.y && rect.x + rect.w >= content.x + content.w && rect.y + rect.h >= content.y + content.h)) return null;
  }
  return null;
}

/** Gefüllte Fläche als PNG (Farbe mit Deckkraft oder Schraffur), auf das Maskenrechteck zugeschnitten. */
export function paintRegion(r: Region, spec: FillSpec): { src: string; rect: BBox } | null {
  let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.mask[y * r.w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r.mask[(y + y0) * r.w + x + x0]) img.data[(y * w + x) * 4 + 3] = 255;
  ctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = spec.color;
  if (!spec.hatch) {
    ctx.globalAlpha = spec.opacity;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Schraffur: Linien im Abstand `gap` (Welt) unter `angle`
    ctx.globalAlpha = Math.max(0.5, spec.opacity);
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = Math.max(1, 1.2 * r.res);
    const g = Math.max(2, spec.hatch.gap * r.res), a = (spec.hatch.angle * Math.PI) / 180, L = Math.hypot(w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(a);
    ctx.beginPath();
    for (let v = -L; v <= L; v += g) { ctx.moveTo(-L, v); ctx.lineTo(L, v); }
    ctx.stroke();
  }
  return { src: c.toDataURL("image/png"), rect: { x: r.rect.x + x0 / r.res, y: r.rect.y + y0 / r.res, w: w / r.res, h: h / r.res } };
}
