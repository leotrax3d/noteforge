// PDF-Import (SPEC §4/§5): jede PDF-Seite wird als feste Hintergrundseite (Element „pdfPage“) gerendert.
import { A4_GAP, a4PageRect, a4Size } from "@/canvas/core/layout";
import { uid } from "@/canvas/core/model";
import { makeObj, type ImageObj } from "@/canvas/core/objects";
import type { PageOrientation } from "@/lib/types";

export interface PdfPageImage {
  src: string;
  /** Seitengröße in PDF-Punkten (1/72 Zoll). */
  w: number;
  h: number;
  text: string;
}

/** Zielbreite der Rasterung in Pixeln (≈ 155 dpi auf A4) – Kompromiss aus Schärfe und Größe. */
const RENDER_W = 1280;
const MAX_PAGES = 200;

export async function pdfToImages(data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<PdfPageImage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, MAX_PAGES);
  const out: PdfPageImage[] = [];
  try {
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: RENDER_W / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim();
      out.push({ src: canvas.toDataURL("image/jpeg", 0.82), w: base.width, h: base.height, text });
      page.cleanup();
      onProgress?.(i, n);
    }
  } finally {
    void task.destroy();
  }
  return out;
}

export const orientationOf = (p: PdfPageImage): PageOrientation => (p.w > p.h ? "landscape" : "portrait");

/**
 * Platziert PDF-Seiten: im A4-Modus je eine Seite pro DIN-A4-Blatt ab `firstIndex`,
 * im Endlosmodus untereinander ab `top` (Breite = A4-Breite).
 */
export function layoutPdfPages(
  pages: PdfPageImage[],
  opts: { mode: "a4" | "infinite"; orientation: PageOrientation; firstIndex?: number; top?: number; z: number },
): ImageObj[] {
  let z = opts.z;
  let y = opts.top ?? 0;
  return pages.map((p, i) => {
    const aspect = p.h / p.w;
    let x: number, w: number, h: number, top: number;
    if (opts.mode === "a4") {
      const r = a4PageRect((opts.firstIndex ?? 0) + i, opts.orientation);
      const k = Math.min(r.w / p.w, r.h / p.h);
      w = p.w * k;
      h = p.h * k;
      x = r.x + (r.w - w) / 2;
      top = r.y + (r.h - h) / 2;
    } else {
      w = a4Size("portrait").w;
      h = w * aspect;
      x = 0;
      top = y;
      y += h + A4_GAP;
    }
    return makeObj<ImageObj>({ id: uid(), kind: "image", z: z++, x, y: top, w, h, angle: 0, data: { src: p.src, locked: true, text: p.text } });
  });
}

/** Erste freie A4-Seite unterhalb von `bottom` (Welt). */
export function firstFreeA4(bottom: number | null, o: PageOrientation) {
  if (bottom === null || bottom <= 0) return 0;
  const { h } = a4Size(o);
  return Math.floor(bottom / (h + A4_GAP)) + 1;
}


