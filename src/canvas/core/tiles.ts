import type { BBox } from "@/lib/types";

export const TILE = 512; // Gerätepixel

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Tile-Cache: gespeicherte Striche + Hintergrund als Bitmaps fester Größe bei
 * einer Render-Skala. Bei Zoom-Gesten werden die Tiles skaliert wiederverwendet
 * und erst nach der Geste in der neuen Auflösung neu gerendert.
 */
export class TileCache {
  /** Gerätepixel pro Welteinheit, für die die Tiles gerendert sind. */
  scale = 1;
  private tiles = new Map<string, Tile>();
  private pool: Tile[] = [];
  constructor(private max = 120) {}

  get worldSize() {
    return TILE / this.scale;
  }

  get size() {
    return this.tiles.size;
  }

  peek(tx: number, ty: number): HTMLCanvasElement | undefined {
    const key = tx + "," + ty;
    const t = this.tiles.get(key);
    if (t) {
      // LRU: ans Ende verschieben
      this.tiles.delete(key);
      this.tiles.set(key, t);
    }
    return t?.canvas;
  }

  create(tx: number, ty: number): CanvasRenderingContext2D | null {
    let t = this.pool.pop();
    if (!t) {
      if (this.tiles.size >= this.max) {
        const oldest = this.tiles.keys().next().value!;
        t = this.tiles.get(oldest)!;
        this.tiles.delete(oldest);
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = TILE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        t = { canvas, ctx };
      }
    }
    this.tiles.set(tx + "," + ty, t);
    const ctx = t.ctx;
    const ws = this.worldSize;
    ctx.setTransform(this.scale, 0, 0, this.scale, -tx * ws * this.scale, -ty * ws * this.scale);
    return ctx;
  }

  /** Kontext einer vorhandenen Kachel (Inhalt bleibt erhalten). */
  existing(tx: number, ty: number): CanvasRenderingContext2D | null {
    const t = this.tiles.get(tx + "," + ty);
    if (!t) return null;
    const ws = this.worldSize;
    t.ctx.setTransform(this.scale, 0, 0, this.scale, -tx * ws * this.scale, -ty * ws * this.scale);
    return t.ctx;
  }

  tileRect(tx: number, ty: number): BBox {
    const ws = this.worldSize;
    return { x: tx * ws, y: ty * ws, w: ws, h: ws };
  }

  invalidate(r: BBox) {
    const ws = this.worldSize;
    const x0 = Math.floor(r.x / ws), x1 = Math.floor((r.x + r.w) / ws);
    const y0 = Math.floor(r.y / ws), y1 = Math.floor((r.y + r.h) / ws);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const key = tx + "," + ty;
        const t = this.tiles.get(key);
        if (t) {
          this.tiles.delete(key);
          this.pool.push(t);
        }
      }
  }

  clear(scale = this.scale) {
    for (const t of this.tiles.values()) this.pool.push(t);
    this.tiles.clear();
    this.scale = scale;
  }
}
