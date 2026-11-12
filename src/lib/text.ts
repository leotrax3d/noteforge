// Spiegel von `onenote::element_text` (Rust) für das In-Memory-Backend und die Tag-Übersicht.
import type { ElementType } from "./types";

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split(/\s+/).filter(Boolean).join(" ");
}

export function elementText(type: ElementType, data: number[] | Uint8Array): string {
  if (type !== "text" && type !== "table" && type !== "pdfPage") return "";
  try {
    const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(data)));
    if (type === "pdfPage") return String(j.data?.text ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (type === "text") return stripHtml(j.data?.html ?? "");
    return (j.data?.cells as string[][] ?? []).flat().map(stripHtml).filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}

/** Seitenlinks `[[Titel]]` in einem Text. */
export function findLinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^[\]\n]{1,120})\]\]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** Vergleich ohne Groß-/Kleinschreibung und Diakritika (Suche im Browser-Backend). */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
