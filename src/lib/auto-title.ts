// Automatischer Blatt-Titel (SPEC §4.2): erste Wörter aus Textcontainern, sonst aus Handschrift.
export const UNTITLED = "Unbenannt";
export const AUTO_WORDS = 3;
export const AUTO_MAX = 40;

/** Erste `n` Wörter, Satzzeichen am Ende weg, höchstens `AUTO_MAX` Zeichen. */
export function titleFromText(text: string, n = AUTO_WORDS): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, n);
  let t = words.join(" ");
  if (t.length > AUTO_MAX) t = t.slice(0, AUTO_MAX).replace(/\s+\S*$/, "") || t.slice(0, AUTO_MAX);
  return t.replace(/[\s.,;:!?…\-–—"'„“”»«)(]+$/u, "").replace(/^[\s"'„“»«(]+/u, "");
}

export function htmlText(html: string): string {
  return html.replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

interface Box { x: number; y: number; w: number; h: number }
/** Lesereihenfolge: oben links nach unten rechts (Zeilen mit Toleranz). */
export function readingOrder<T extends { bbox: Box }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const tol = Math.min(a.bbox.h, b.bbox.h) / 2;
    if (Math.abs(a.bbox.y - b.bbox.y) > tol) return a.bbox.y - b.bbox.y;
    return a.bbox.x - b.bbox.x;
  });
}

/** Titel aus Textcontainern; "" wenn keiner Text enthält. */
export function titleFromTexts(objs: { bbox: Box; html: string; latex?: string }[]): string {
  for (const o of readingOrder(objs)) {
    const t = titleFromText(o.latex ? "" : htmlText(o.html));
    if (t) return t;
  }
  return "";
}
