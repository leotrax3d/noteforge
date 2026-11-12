import type { BBox, CanvasElement } from "@/lib/types";
import { apply, type Mat } from "./geometry";

/** Nicht-Strich-Elemente (SPEC §3): Textcontainer, Bilder, Tabellen. */
export type ObjKind = "text" | "image" | "table";

export interface TextData { html: string }
export interface ImageData { src: string }
export interface TableData { cells: string[][] }

interface Base {
  id: string;
  z: number;
  /** Oben links vor der Drehung (Welt). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drehung um die Mitte (Radiant). */
  angle: number;
  bbox: BBox;
}
export type TextObj = Base & { kind: "text"; data: TextData };
export type ImageObj = Base & { kind: "image"; data: ImageData };
export type TableObj = Base & { kind: "table"; data: TableData };
export type CanvasObj = TextObj | ImageObj | TableObj;

export function objBBox(o: Pick<Base, "x" | "y" | "w" | "h" | "angle">): BBox {
  if (!o.angle) return { x: o.x, y: o.y, w: o.w, h: o.h };
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(o.angle), s = Math.sin(o.angle);
  const ex = Math.abs(c * o.w / 2) + Math.abs(s * o.h / 2), ey = Math.abs(s * o.w / 2) + Math.abs(c * o.h / 2);
  return { x: cx - ex, y: cy - ey, w: 2 * ex, h: 2 * ey };
}

/** Objekt mit neu berechneter BBox. */
export function makeObj<T extends CanvasObj>(o: Omit<T, "bbox"> & { bbox?: BBox }): T {
  return { ...o, bbox: objBBox(o) } as T;
}

/** Ecken (Welt) im Uhrzeigersinn ab oben links. */
export function objCorners(o: CanvasObj) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(o.angle), s = Math.sin(o.angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const dx = (u * o.w) / 2, dy = (v * o.h) / 2;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}

/** Ähnlichkeitstransformation einbacken (Verschieben/Drehen/gleichmäßig Skalieren). */
export function transformObj<T extends CanvasObj>(o: T, m: Mat, id = o.id): T {
  const c = apply(m, o.x + o.w / 2, o.y + o.h / 2);
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const theta = Math.atan2(m[1], m[0]);
  const w = o.w * s, h = o.h * s;
  return makeObj<T>({ ...o, id, x: c.x - w / 2, y: c.y - h / 2, w, h, angle: o.angle + theta });
}

export function hitObj(o: CanvasObj, x: number, y: number): boolean {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(-o.angle), s = Math.sin(-o.angle);
  const dx = x - cx, dy = y - cy;
  const u = dx * c - dy * s, v = dx * s + dy * c;
  return Math.abs(u) <= o.w / 2 && Math.abs(v) <= o.h / 2;
}

// ---- Persistenz: JSON (UTF-8) im data-Blob ----
const enc = new TextEncoder();
const dec = new TextDecoder();

export function objToElement(o: CanvasObj, pageId: string): CanvasElement {
  const { x, y, w, h, angle, data } = o;
  return { id: o.id, pageId, type: o.kind, z: o.z, bbox: o.bbox, data: Array.from(enc.encode(JSON.stringify({ v: 1, x, y, w, h, angle, data }))) };
}

export function elementToObj(e: CanvasElement): CanvasObj | null {
  if (e.type !== "text" && e.type !== "image" && e.type !== "table") return null;
  try {
    const j = JSON.parse(dec.decode(Uint8Array.from(e.data)));
    if (j.v !== 1) return null;
    return makeObj({ id: e.id, z: e.z, kind: e.type, x: j.x, y: j.y, w: j.w, h: j.h, angle: j.angle ?? 0, data: j.data } as CanvasObj);
  } catch {
    return null;
  }
}
