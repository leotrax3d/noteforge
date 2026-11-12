// Eigene Formvorlagen: über Tauri-Commands in SQLite, im Browser im Speicher.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/api";
import { decodeStroke, encodeStroke } from "@/canvas/core/codec";
import { transformStroke } from "@/canvas/core/geometry";
import { makeObj, transformObj, type ImageObj } from "@/canvas/core/objects";
import type { Stroke } from "@/canvas/core/model";
import type { BBox } from "@/lib/types";

export interface ShapeTemplate { id: string; name: string; data: string; createdAt: number }

const mem: ShapeTemplate[] = [];

export const shapesApi = {
  list: (): Promise<ShapeTemplate[]> => (inTauri ? invoke("list_shape_templates") : Promise.resolve([...mem])),
  save: async (name: string, data: string): Promise<ShapeTemplate> => {
    if (inTauri) return invoke("save_shape_template", { name, data });
    if (!name.trim()) throw new Error("Name darf nicht leer sein");
    const t = { id: crypto.randomUUID(), name: name.trim(), data, createdAt: Date.now() };
    mem.unshift(t);
    return t;
  },
  remove: async (id: string) => {
    if (inTauri) return invoke<void>("delete_shape_template", { id });
    const i = mem.findIndex((t) => t.id === id);
    if (i >= 0) mem.splice(i, 1);
  },
};

interface Encoded { v: 1; w: number; h: number; strokes: { b: string; z: number }[]; objs: Omit<ImageObj, "bbox">[] }

const b64 = (u: Uint8Array) => { let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Auswahl (Weltkoordinaten) → JSON relativ zur oberen linken Ecke. */
export function encodeTemplate(strokes: Stroke[], objs: ImageObj[], bbox: BBox): string {
  const off = [1, 0, 0, 1, -bbox.x, -bbox.y] as [number, number, number, number, number, number];
  const e: Encoded = {
    v: 1, w: bbox.w, h: bbox.h,
    strokes: strokes.map((s) => ({ b: b64(encodeStroke(transformStroke(s, off))), z: s.z })),
    objs: objs.map((o) => { const { bbox: _b, ...rest } = transformObj(o, off); void _b; return rest; }),
  };
  return JSON.stringify(e);
}

export function decodeTemplate(data: string): { strokes: Stroke[]; objs: ImageObj[]; w: number; h: number } {
  const e = JSON.parse(data) as Encoded;
  return {
    w: e.w, h: e.h,
    strokes: e.strokes.map((s, i) => decodeStroke(`t${i}`, s.z, unb64(s.b))),
    objs: e.objs.map((o) => makeObj<ImageObj>(o)),
  };
}
