// Zoomabhängiges PDF-Rendering (Level of Detail): Seiten werden in Kacheln je Zoomstufe
// (Zweierpotenzen) mit pdf.js gerastert und gecacht. Bis die scharfe Stufe da ist, wird die
// vorhandene (gröbere) Stufe bzw. das Vorschaubild skaliert gezeichnet.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BBox } from "@/lib/types";
import type { ImageObj } from "./objects";

export interface PdfRef {
  /** Asset-ID der Original-PDF */
  asset: string;
  /** Seitenindex ab 0 */
  page: number;
  /** Seitengröße in PDF-Punkten */
  pw: number;
  ph: number;
}

/** Kachelgröße in Gerätepixeln */
export const CHUNK = 512;
const MIN_LEVEL = -3, MAX_LEVEL = 5;
/** Speichergrenze des Kachel-Caches (Bytes, RGBA). */
export const PDF_CACHE_BYTES = 192 * 1024 * 1024;
const MAX_QUEUE = 48;
const MAX_DOCS = 4;

interface Chunk { canvas: HTMLCanvasElement; bytes: number }
interface Job { key: string; ref: PdfRef; level: number; cx: number; cy: number }

/** Zoomstufe (Gerätepixel pro PDF-Punkt = 2^level) für die gewünschte Auflösung. */
export function levelFor(pxPerPt: number) {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.ceil(Math.log2(Math.max(1e-6, pxPerPt)) - 1e-9))) + 0; // + 0: kein -0
}

/** Sichtbare Kachelindizes einer Seite auf Stufe `level` für den lokalen Ausschnitt (in PDF-Punkten). */
export function chunkRange(ref: PdfRef, level: number, u0: number, v0: number, u1: number, v1: number) {
  const ls = 2 ** level, span = CHUNK / ls;
  const nx = Math.ceil((ref.pw * ls) / CHUNK), ny = Math.ceil((ref.ph * ls) / CHUNK);
  return {
    x0: Math.max(0, Math.floor(u0 / span)), y0: Math.max(0, Math.floor(v0 / span)),
    x1: Math.min(nx - 1, Math.floor(u1 / span)), y1: Math.min(ny - 1, Math.floor(v1 / span)),
  };
}

export class PdfRaster {
  onReady: ((asset: string, page: number) => void) | null = null;
  private docs = new Map<string, Promise<PDFDocumentProxy>>();
  private cache = new Map<string, Chunk>();
  private bytes = 0;
  private queue: Job[] = [];
  private queued = new Set<string>();
  private running = false;
  private failed = new Set<string>();

  constructor(private load: (asset: string) => Promise<Uint8Array>, private limit = PDF_CACHE_BYTES) {}

  get cachedBytes() {
    return this.bytes;
  }

  destroy() {
    this.onReady = null;
    this.queue = [];
    this.queued.clear();
    this.cache.clear();
    this.bytes = 0;
    for (const d of this.docs.values()) void d.then((x) => x.loadingTask.destroy()).catch(() => {});
    this.docs.clear();
  }

  /**
   * Zeichnet die verfügbaren Kacheln der PDF-Seite in den lokalen Objekt-Transform
   * (Ursprung = Objektmitte, wie drawImageObj). `pxPerWorld` = Gerätepixel pro Welteinheit,
   * `clip` = sichtbarer Bereich (Welt). Fehlende Kacheln werden angefordert.
   */
  draw(ctx: CanvasRenderingContext2D, o: ImageObj, ref: PdfRef, pxPerWorld: number, clip: BBox) {
    if (this.failed.has(ref.asset)) return;
    const ptToWorld = o.w / ref.pw;
    const level = levelFor(pxPerWorld * ptToWorld);
    // Lokaler Ausschnitt in PDF-Punkten (bei Drehung: ganze Seite)
    let u0 = 0, v0 = 0, u1 = ref.pw, v1 = ref.ph;
    if (!o.angle) {
      u0 = (clip.x - o.x) / ptToWorld; v0 = (clip.y - o.y) / ptToWorld;
      u1 = (clip.x + clip.w - o.x) / ptToWorld; v1 = (clip.y + clip.h - o.y) / ptToWorld;
    }
    const r = chunkRange(ref, level, u0, v0, u1, v1);
    for (let cy = r.y0; cy <= r.y1; cy++)
      for (let cx = r.x0; cx <= r.x1; cx++) {
        const key = keyOf(ref, level, cx, cy);
        const c = this.get(key);
        if (c) {
          this.blit(ctx, o, ref, level, cx, cy, c.canvas, ptToWorld);
          continue;
        }
        this.request({ key, ref, level, cx, cy });
        // Gröbere Stufe skaliert zeigen, bis die scharfe fertig ist
        for (let l = level - 1; l >= Math.max(MIN_LEVEL, level - 4); l--) {
          const f = 2 ** (level - l);
          const px = Math.floor(cx / f), py = Math.floor(cy / f);
          const cc = this.get(keyOf(ref, l, px, py));
          if (cc) {
            this.blit(ctx, o, ref, l, px, py, cc.canvas, ptToWorld);
            break;
          }
        }
      }
  }

  private blit(ctx: CanvasRenderingContext2D, o: ImageObj, ref: PdfRef, level: number, cx: number, cy: number, c: HTMLCanvasElement, ptToWorld: number) {
    const span = CHUNK / 2 ** level; // PDF-Punkte pro Kachel
    const k = ptToWorld * (span / CHUNK); // Welt pro Kachelpixel
    ctx.drawImage(c, -o.w / 2 + cx * span * ptToWorld, -o.h / 2 + cy * span * ptToWorld, c.width * k, c.height * k);
    void ref;
  }

  private get(key: string): Chunk | undefined {
    const c = this.cache.get(key);
    if (c) {
      this.cache.delete(key);
      this.cache.set(key, c); // LRU
    }
    return c;
  }

  private request(j: Job) {
    if (this.queued.has(j.key)) return;
    this.queued.add(j.key);
    this.queue.push(j);
    while (this.queue.length > MAX_QUEUE) this.queued.delete(this.queue.shift()!.key); // veraltete Wünsche verwerfen
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const j = this.queue.pop()!; // neueste zuerst (aktueller Ausschnitt)
        this.queued.delete(j.key);
        if (this.cache.has(j.key)) continue;
        try {
          const canvas = await this.render(j);
          this.store(j.key, canvas);
          this.onReady?.(j.ref.asset, j.ref.page);
        } catch (e) {
          console.warn("PDF-Kachel", e);
          this.failed.add(j.ref.asset);
          this.queue = this.queue.filter((q) => q.ref.asset !== j.ref.asset);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private store(key: string, canvas: HTMLCanvasElement) {
    const bytes = canvas.width * canvas.height * 4;
    this.cache.set(key, { canvas, bytes });
    this.bytes += bytes;
    for (const [k, c] of this.cache) {
      if (this.bytes <= this.limit) break;
      if (k === key) continue;
      this.cache.delete(k);
      this.bytes -= c.bytes;
      c.canvas.width = c.canvas.height = 0; // Speicher sofort freigeben
    }
  }

  private doc(asset: string): Promise<PDFDocumentProxy> {
    let d = this.docs.get(asset);
    if (!d) {
      d = (async () => {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        return pdfjs.getDocument({ data: (await this.load(asset)).slice() }).promise;
      })();
      this.docs.set(asset, d);
      while (this.docs.size > MAX_DOCS) {
        const [k, old] = this.docs.entries().next().value!;
        this.docs.delete(k);
        void old.then((x) => x.loadingTask.destroy()).catch(() => {});
      }
    } else {
      this.docs.delete(asset);
      this.docs.set(asset, d);
    }
    return d;
  }

  private async render(j: Job): Promise<HTMLCanvasElement> {
    const doc = await this.doc(j.ref.asset);
    const page = await doc.getPage(j.ref.page + 1);
    const ls = 2 ** j.level;
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: ls * (j.ref.pw / base.width), offsetX: -j.cx * CHUNK, offsetY: -j.cy * CHUNK });
    const fullW = Math.ceil(j.ref.pw * ls), fullH = Math.ceil(j.ref.ph * ls);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.min(CHUNK, fullW - j.cx * CHUNK));
    canvas.height = Math.max(1, Math.min(CHUNK, fullH - j.cy * CHUNK));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }
}

const keyOf = (r: PdfRef, l: number, x: number, y: number) => `${r.asset}|${r.page}|${l}|${x}|${y}`;
