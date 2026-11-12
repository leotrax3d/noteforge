import type { BBox } from "@/lib/types";
import { MM, a4PageRect, type PageSetup } from "./layout";
import { invertLightness } from "./color";

export interface Palette {
  dark: boolean;
  desk: string;
  line: string;
}

export const PALETTES = {
  light: { dark: false, desk: "#d9dce1", line: "rgba(30, 64, 120, 0.16)" },
  dark: { dark: true, desk: "#0c0c0e", line: "rgba(255, 255, 255, 0.12)" },
} satisfies Record<string, Palette>;

export function pageFill(setup: PageSetup, pal: Palette) {
  const c = /^#[0-9a-f]{6}$/i.test(setup.pageColor) ? setup.pageColor : "#ffffff";
  return pal.dark ? invertLightness(c) === "#000000" ? "#1c1c1f" : invertLightness(c) : c;
}

/**
 * Zeichnet Hintergrund (Muster) für einen Weltausschnitt. ctx steht im
 * Welt-Transform; `scale` = Gerätepixel pro Welteinheit (für 1-px-Linien).
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  r: BBox,
  scale: number,
  setup: PageSetup,
  pal: Palette,
  pageCount: number,
) {
  const fill = pageFill(setup, pal);
  if (setup.mode === "infinite") {
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    pattern(ctx, r, scale, setup, pal, 0, 0);
    return;
  }
  ctx.fillStyle = pal.desk;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  for (let i = 0; i < pageCount; i++) {
    const p = a4PageRect(i, setup.orientation);
    if (p.x > r.x + r.w || p.x + p.w < r.x || p.y > r.y + r.h || p.y + p.h < r.y) continue;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(p.x + 2 / scale, p.y + 3 / scale, p.w, p.h);
    ctx.fillStyle = fill;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    const ix = Math.max(r.x, p.x), iy = Math.max(r.y, p.y);
    const clip = { x: ix, y: iy, w: Math.min(r.x + r.w, p.x + p.w) - ix, h: Math.min(r.y + r.h, p.y + p.h) - iy };
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    pattern(ctx, clip, scale, setup, pal, p.x, p.y);
    ctx.restore();
  }
}

function pattern(ctx: CanvasRenderingContext2D, r: BBox, scale: number, s: PageSetup, pal: Palette, ox: number, oy: number) {
  if (s.background === "blank") return;
  const step = Math.max(1, s.bgSpacingMm) * MM;
  if (step * scale < 4) return; // zu dicht bei kleinem Zoom
  const px = 1 / scale;
  const x0 = ox + Math.floor((r.x - ox) / step) * step;
  const y0 = oy + Math.floor((r.y - oy) / step) * step;
  ctx.fillStyle = pal.line;
  if (s.background === "dots") {
    const d = Math.max(px * 1.6, 0.5);
    for (let y = y0; y <= r.y + r.h; y += step)
      for (let x = x0; x <= r.x + r.w; x += step) ctx.fillRect(x - d / 2, y - d / 2, d, d);
    return;
  }
  for (let y = y0; y <= r.y + r.h; y += step) ctx.fillRect(r.x, y, r.w, px);
  if (s.background === "grid") for (let x = x0; x <= r.x + r.w; x += step) ctx.fillRect(x, r.y, px, r.h);
}
