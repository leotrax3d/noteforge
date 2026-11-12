// Vektor-Spezifikation ↔ Bild-Element.
import { makeObj, type ImageObj } from "../core/objects";
import type { Vec } from "../core/geometry";
import { uid } from "../core/model";
import { renderVec, svgUrl, type VecSpec } from "./vec";

/** Neues Element; Linien/Winkel liegen in Weltkoordinaten, alles andere mit oben links bei `at`. */
export function vecObj(spec: VecSpec, at: Vec | null, z: number): ImageObj {
  const r = renderVec(spec);
  const x = at ? at.x : -r.ox, y = at ? at.y : -r.oy;
  return makeObj<ImageObj>({ id: uid(), kind: "image", z, x, y, w: r.w, h: r.h, angle: 0, data: { src: svgUrl(r.svg), vec: spec } });
}

/** Spezifikation geändert: neu rendern, Lage/Drehung/Skalierung (oben links) behalten. */
export function updateVecObj(o: ImageObj, spec: VecSpec): ImageObj {
  const r = renderVec(spec);
  const old = o.data.vec && o.data.vec.t !== "fill" ? renderVec(o.data.vec) : null;
  const k = old ? o.w / old.w : 1;
  return makeObj<ImageObj>({ ...o, w: r.w * k, h: r.h * k, data: { ...o.data, src: svgUrl(r.svg), vec: spec } });
}

/** Anschlüsse eines Schaltzeichens in Weltkoordinaten. */
export function terminalsOf(o: ImageObj): Vec[] {
  const v = o.data.vec;
  if (!v || v.t !== "symbol") return [];
  const r = renderVec(v);
  const kx = o.w / r.w, ky = o.h / r.h, cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(o.angle), s = Math.sin(o.angle);
  return (r.terminals ?? []).map((t) => {
    const dx = t.x * kx - o.w / 2, dy = t.y * ky - o.h / 2;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}

/** Linien-Endpunkt an nahen Anschlüssen einrasten. */
export function snapToTerminal(p: Vec, objs: ImageObj[], tol: number): Vec {
  let best: Vec | null = null, bd = tol;
  for (const o of objs) for (const t of terminalsOf(o)) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best ?? p;
}

/** Punkte einer Vektorlinie in Weltkoordinaten (Verschieben/Skalieren/Drehen eingerechnet). */
export function vecLinePts(o: ImageObj): Vec[] {
  const v = o.data.vec;
  if (!v || v.t !== "line") return [];
  const r = renderVec(v);
  const kx = o.w / r.w, ky = o.h / r.h, cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(o.angle), s = Math.sin(o.angle);
  return v.pts.map((p) => {
    const dx = (p.x + r.ox) * kx - o.w / 2, dy = (p.y + r.oy) * ky - o.h / 2;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}
