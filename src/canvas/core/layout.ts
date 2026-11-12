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

/** Rand neben/über den A4-Seiten und Höhe der „Seite hinzufügen“-Zone (Welt). */
export const A4_MARGIN = 40;
export const A4_ADD_ZONE = 96;

export interface CamBounds { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Erlaubter Bereich für die Kamera-Ecke (cam.x/cam.y) im A4-Modus bei Sichtgröße `vw`×`vh` (Welt):
 * seitlich Seitenbreite plus Rand (schmaler als die Sicht → zentriert), oben bis zur ersten Seite,
 * unten bis zur letzten Seite plus „Seite hinzufügen“-Zone.
 */
export function a4CamBounds(o: PageOrientation, pageCount: number, vw: number, vh: number): CamBounds {
  const { w, h } = a4Size(o);
  const m = A4_MARGIN;
  let minX: number, maxX: number;
  if (vw >= w + 2 * m) minX = maxX = (w - vw) / 2;
  else { minX = -m; maxX = w + m - vw; }
  const total = pageCount * (h + A4_GAP) - A4_GAP + A4_ADD_ZONE;
  const minY = -m;
  const maxY = Math.max(minY, total + m - vh);
  return { minX, maxX, minY, maxY };
}

/** Gummiband: innerhalb [min, max] unverändert, darüber hinaus zunehmend gebremst (max. `dim`). */
export function rubber(v: number, min: number, max: number, dim: number): number {
  const r = (d: number) => (1 - 1 / ((d * 0.55) / dim + 1)) * dim;
  if (v < min) return min - r(min - v);
  if (v > max) return max + r(v - max);
  return v;
}

export const clampTo = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
