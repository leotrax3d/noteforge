import { PEN_KINDS, PSTRIDE, makeStroke, type Stroke } from "./model";
import type { CanvasElement } from "@/lib/types";

/**
 * Binärformat eines Strichs (Little Endian):
 *  u8 Version(1) · u8 Stift · u8 Flags(bit0 = Druck) · u8 reserviert
 *  u32 RGB · f32 Breite · f32 Opazität · u32 Punktanzahl · f32[n·5] Punkte
 */
const HEADER = 20;

export function encodeStroke(s: Stroke): Uint8Array {
  const n = s.points.length / PSTRIDE;
  const buf = new ArrayBuffer(HEADER + s.points.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint8(1, PEN_KINDS.indexOf(s.pen));
  v.setUint8(2, s.pressure ? 1 : 0);
  v.setUint32(4, parseInt(s.color.slice(1, 7), 16), true);
  v.setFloat32(8, s.width, true);
  v.setFloat32(12, s.opacity, true);
  v.setUint32(16, n, true);
  new Float32Array(buf, HEADER).set(s.points);
  return new Uint8Array(buf);
}

export function decodeStroke(id: string, z: number, bytes: Uint8Array): Stroke {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== 1) throw new Error("Unbekanntes Strichformat");
  const n = v.getUint32(16, true);
  const points = new Float32Array(n * PSTRIDE);
  for (let i = 0; i < points.length; i++) points[i] = v.getFloat32(HEADER + i * 4, true);
  return makeStroke({
    id,
    z,
    pen: PEN_KINDS[v.getUint8(1)] ?? "ballpoint",
    pressure: (v.getUint8(2) & 1) === 1,
    color: "#" + v.getUint32(4, true).toString(16).padStart(6, "0"),
    width: v.getFloat32(8, true),
    opacity: v.getFloat32(12, true),
    points,
  });
}

export function strokeToElement(s: Stroke, pageId: string): CanvasElement {
  return { id: s.id, pageId, type: "stroke", z: s.z, bbox: s.bbox, data: Array.from(encodeStroke(s)) };
}

export function elementToStroke(e: CanvasElement): Stroke | null {
  if (e.type !== "stroke") return null;
  try {
    return decodeStroke(e.id, e.z, Uint8Array.from(e.data));
  } catch {
    return null;
  }
}
