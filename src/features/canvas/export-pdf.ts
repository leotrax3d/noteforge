// PDF-Export (SPEC §5): Blatt, Thema oder Fach.
import { elementToStroke } from "@/canvas/core/codec";
import { elementToObj, type CanvasObj } from "@/canvas/core/objects";
import type { Stroke } from "@/canvas/core/model";
import { buildPdf, type PdfImagePage } from "@/canvas/export/pdf";
import { loadImages, planSheets, renderSheet } from "@/canvas/export/render";
import { api } from "@/lib/api";
import { flattenSection } from "@/lib/tree";
import type { Page, Section } from "@/lib/types";

export type ExportScope = "page" | "section" | "subject";

/** Blätter in Baum-Reihenfolge (Unterblätter direkt nach dem Elternblatt). */
export function pagesInScope(scope: ExportScope, page: Page, sections: Section[], pages: Page[]): Page[] {
  if (scope === "page") return [page];
  const secs = scope === "section" ? sections.filter((s) => s.id === page.sectionId) : sections;
  return secs.flatMap((s) => flattenSection(pages, s.id, new Set()).map((f) => f.page));
}

const toJpeg = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((res, rej) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("JPEG-Kodierung fehlgeschlagen"))), "image/jpeg", 0.88),
  );

export async function exportPdf(pages: Page[], title: string, onProgress?: (msg: string) => void): Promise<Uint8Array> {
  const out: PdfImagePage[] = [];
  for (const [i, p] of pages.entries()) {
    onProgress?.(`Blatt ${i + 1} von ${pages.length} …`);
    const els = await api.listElements(p.id);
    const src = {
      setup: { mode: p.mode, orientation: p.orientation, background: p.background, bgSpacingMm: p.bgSpacingMm, pageColor: p.pageColor },
      strokes: els.map(elementToStroke).filter((s): s is Stroke => !!s),
      objs: els.map(elementToObj).filter((o): o is CanvasObj => !!o),
    };
    const images = await loadImages(src.objs);
    for (const [k, sheet] of planSheets(src).entries()) {
      const c = renderSheet(src, sheet, images, 150, k);
      out.push({ jpeg: await toJpeg(c), px: { w: c.width, h: c.height }, mm: sheet.mm });
    }
  }
  return buildPdf(out, { title });
}

export const pdfFileName = (s: string) => `${(s.trim() || "Noteforge").replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
