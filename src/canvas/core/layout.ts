import type { PageBackground, PageMode, PageOrientation } from "@/lib/types";

/** Weltkoordinaten: 1 Einheit = 1 CSS-Pixel bei 100 % (96 dpi). */
export const MM = 96 / 25.4;
export const A4_GAP = 32;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export interface PageSetup {
  mode: PageMode;
  orientation: PageOrientation;
  background: PageBackground;
  bgSpacingMm: number;
  pageColor: string;
}

export function a4Size(o: PageOrientation) {
  const w = 210 * MM, h = 297 * MM;
  return o === "portrait" ? { w, h } : { w: h, h: w };
}

/** Anzahl DIN-A4-Seiten: immer eine leere Seite unter der letzten beschriebenen. */
export function a4PageCount(contentBottom: number, o: PageOrientation): number {
  if (!(contentBottom > 0)) return 1;
  const { h } = a4Size(o);
  return Math.floor(contentBottom / (h + A4_GAP)) + 2;
}

export function a4PageRect(i: number, o: PageOrientation) {
  const { w, h } = a4Size(o);
  return { x: 0, y: i * (h + A4_GAP), w, h };
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
