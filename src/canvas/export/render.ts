import { latexToPlain } from "@/features/recognition/latex";
// Offscreen-Rendering eines Blatts in DIN-A4-Bögen (PDF-Export, Drucken).
import { PALETTES, drawBackground } from "../core/background";
import { drawImageObj } from "../core/engine";
import { A4_GAP, MM, a4PageRect, a4Size, type PageSetup } from "../core/layout";
import type { Stroke } from "../core/model";
import type { CanvasObj, ImageObj, TableObj, TextObj } from "../core/objects";
import { drawStroke } from "../core/pens";
import type { BBox } from "@/lib/types";
import { sanitizeHtml } from "@/features/canvas/objects/sanitize";

export interface SheetSource {
  setup: PageSetup;
  strokes: Stroke[];
  objs: CanvasObj[];
}

export interface Sheet {
  /** Weltausschnitt des Bogens. */
  rect: BBox;
  mm: { w: number; h: number };
}

const MARGIN = 10 * MM;

function bounds(src: SheetSource): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of [...src.strokes, ...src.objs]) {
    x0 = Math.min(x0, e.bbox.x); y0 = Math.min(y0, e.bbox.y);
    x1 = Math.max(x1, e.bbox.x + e.bbox.w); y1 = Math.max(y1, e.bbox.y + e.bbox.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Aufteilung in Bögen: A4-Blätter 1:1 (bis zur letzten beschriebenen Seite);
 * Endlosblätter werden auf A4-Breite eingepasst und in A4-Höhe geschnitten.
 */
export function planSheets(src: SheetSource): Sheet[] {
  const b = bounds(src);
  const o = src.setup.orientation;
  if (src.setup.mode === "a4") {
    const { h } = a4Size(o);
    const last = b ? Math.max(0, Math.floor((b.y + b.h - 1) / (h + A4_GAP))) : 0;
    const mm = o === "portrait" ? { w: 210, h: 297 } : { w: 297, h: 210 };
    return Array.from({ length: last + 1 }, (_, i) => ({ rect: a4PageRect(i, o), mm }));
  }
  const page = a4Size("portrait");
  const r = b ?? { x: 0, y: 0, w: page.w - 2 * MARGIN, h: 1 };
  const worldW = Math.max(page.w, r.w + 2 * MARGIN);
  const worldH = (worldW * page.h) / page.w;
  const x = r.w + 2 * MARGIN >= page.w ? r.x - MARGIN : Math.min(r.x - MARGIN, 0);
  const n = Math.max(1, Math.ceil((r.h + 2 * MARGIN) / worldH));
  return Array.from({ length: n }, (_, i) => ({ rect: { x, y: r.y - MARGIN + i * worldH, w: worldW, h: worldH }, mm: { w: 210, h: 297 } }));
}

export async function loadImages(objs: CanvasObj[]): Promise<Map<string, HTMLImageElement>> {
  const m = new Map<string, HTMLImageElement>();
  await Promise.all(objs.filter((o): o is ImageObj => o.kind === "image").map(async (o) => {
    if (m.has(o.data.src)) return;
    const img = new Image();
    img.src = o.data.src;
    m.set(o.data.src, img);
    try {
      await img.decode();
    } catch {
      /* fehlendes Bild → Platzhalter */
    }
  }));
  return m;
}

/** Zeichnet einen Bogen in ein neues Canvas mit `dpi` Auflösung. */
export function renderSheet(src: SheetSource, sheet: Sheet, images: Map<string, HTMLImageElement>, dpi = 150, index = 0): HTMLCanvasElement {
  const pxW = Math.round((sheet.mm.w / 25.4) * dpi), pxH = Math.round((sheet.mm.h / 25.4) * dpi);
  const c = document.createElement("canvas");
  c.width = pxW;
  c.height = pxH;
  const ctx = c.getContext("2d")!;
  const k = pxW / sheet.rect.w;
  ctx.setTransform(k, 0, 0, k, -sheet.rect.x * k, -sheet.rect.y * k);
  drawBackground(ctx, sheet.rect, k, src.setup, PALETTES.light, index + 1);
  const inside = (e: { bbox: BBox }) =>
    e.bbox.x < sheet.rect.x + sheet.rect.w && e.bbox.x + e.bbox.w > sheet.rect.x &&
    e.bbox.y < sheet.rect.y + sheet.rect.h && e.bbox.y + e.bbox.h > sheet.rect.y;
  for (const o of src.objs) if (o.kind === "image" && inside(o)) drawImageObj(ctx, o, images.get(o.data.src));
  for (const s of src.strokes) if (inside(s)) drawStroke(ctx, s, false);
  for (const o of src.objs) {
    if (!inside(o)) continue;
    if (o.kind === "text") drawTextObj(ctx, o);
    else if (o.kind === "table") drawTableObj(ctx, o);
  }
  return c;
}

// ---------- Rich Text (vereinfachtes Layout wie .nf-rich) ----------

interface Run { text: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string; size: number }
interface Block { runs: Run[]; size: number; bullet: string; indent: number }

const BASE = 16;
const LH = 1.375;
const INK = "#111827";

/** HTML → Absätze mit formatierten Läufen. */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${sanitizeHtml(html)}</body>`, "text/html");
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const open = (size: number, bullet = "", indent = 0) => {
    cur = { runs: [], size, bullet, indent };
    blocks.push(cur);
    return cur;
  };
  type Style = Omit<Run, "text">;
  const walk = (n: Node, st: Style, list: { ordered: boolean; i: number } | null, indent: number) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n as Text).data.replace(/\s+/g, " ");
      if (!t) return;
      (cur ?? open(st.size, "", indent)).runs.push({ ...st, text: t });
      return;
    }
    if (!(n instanceof Element)) return;
    const tag = n.tagName;
    const s: Style = { ...st };
    if (tag === "B" || tag === "STRONG" || tag === "TH") s.bold = true;
    if (tag === "I" || tag === "EM") s.italic = true;
    if (tag === "U") s.underline = true;
    if (tag === "S") s.strike = true;
    const color = n.getAttribute("color") ?? (n as HTMLElement).style?.color;
    if (color) s.color = color;
    if (tag === "BR") return void open(st.size, "", indent);
    if (tag === "H1" || tag === "H2" || tag === "H3") {
      s.size = BASE * (tag === "H1" ? 1.6 : tag === "H2" ? 1.3 : 1.1);
      s.bold = true;
      open(s.size, "", indent);
      n.childNodes.forEach((c) => walk(c, s, list, indent));
      cur = null;
      return;
    }
    if (tag === "UL" || tag === "OL") {
      const l = { ordered: tag === "OL", i: 0 };
      n.childNodes.forEach((c) => walk(c, s, l, indent + 1.4 * BASE));
      cur = null;
      return;
    }
    if (tag === "LI") {
      const b = list ? (list.ordered ? `${++list.i}.` : "•") : "•";
      open(s.size, b, indent);
      n.childNodes.forEach((c) => walk(c, s, null, indent));
      cur = null;
      return;
    }
    if (tag === "TR") {
      open(s.size, "", indent);
      [...n.children].forEach((c, i) => {
        if (i) cur!.runs.push({ ...s, text: " | " });
        c.childNodes.forEach((x) => walk(x, s, null, indent));
      });
      cur = null;
      return;
    }
    const block = tag === "P" || tag === "DIV" || tag === "TABLE" || tag === "TBODY" || tag === "THEAD";
    if (block) cur = null;
    n.childNodes.forEach((c) => walk(c, s, list, indent));
    if (block) cur = null;
  };
  walk(doc.body, { bold: false, italic: false, underline: false, strike: false, color: INK, size: BASE }, null, 0);
  return blocks;
}

const font = (r: Pick<Run, "bold" | "italic" | "size">) =>
  `${r.italic ? "italic " : ""}${r.bold ? "600 " : ""}${r.size}px system-ui, "Segoe UI", sans-serif`;

/** Zeichnet Absätze umbrechend in die Breite `w`; liefert die genutzte Höhe. */
export function drawBlocks(ctx: CanvasRenderingContext2D, blocks: Block[], x: number, y: number, w: number): number {
  let cy = y;
  ctx.textBaseline = "alphabetic";
  for (const b of blocks) {
    const lh = b.size * LH;
    const left = x + b.indent;
    if (b.bullet) {
      ctx.font = font({ bold: false, italic: false, size: b.size });
      ctx.fillStyle = INK;
      const bw = ctx.measureText(b.bullet).width;
      ctx.fillText(b.bullet, left - bw - 6, cy + b.size);
    }
    // Wörter mit Format in Zeilen setzen
    let cx = left;
    const line: { t: string; r: Run; x: number }[] = [];
    const flush = () => {
      for (const p of line) {
        ctx.font = font(p.r);
        ctx.fillStyle = p.r.color;
        ctx.fillText(p.t, p.x, cy + b.size);
        const tw = ctx.measureText(p.t).width;
        if (p.r.underline || p.r.strike) {
          const ly = cy + b.size + (p.r.underline ? 2 : -p.r.size * 0.3);
          ctx.fillRect(p.x, ly, tw, Math.max(1, p.r.size / 14));
        }
      }
      line.length = 0;
      cy += lh;
      cx = left;
    };
    for (const r of b.runs) {
      ctx.font = font(r);
      for (const word of r.text.split(/(?<= )/)) {
        const ww = ctx.measureText(word).width;
        if (cx + ww > x + w && cx > left) flush();
        line.push({ t: word, r, x: cx });
        cx += ww;
      }
    }
    flush();
  }
  return cy - y;
}

function rotated(ctx: CanvasRenderingContext2D, o: CanvasObj, draw: () => void) {
  ctx.save();
  if (o.angle) {
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.rotate(o.angle);
    ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2));
  }
  draw();
  ctx.restore();
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function drawTextObj(ctx: CanvasRenderingContext2D, o: TextObj) {
  const html = o.data.latex != null ? `<i>${escapeHtml(latexToPlain(o.data.latex))}</i>` : o.data.html;
  rotated(ctx, o, () => drawBlocks(ctx, htmlToBlocks(html), o.x + 8, o.y + 6, o.w - 16));
}

export function drawTableObj(ctx: CanvasRenderingContext2D, o: TableObj) {
  rotated(ctx, o, () => {
    const rows = o.data.cells;
    const cols = rows[0]?.length ?? 1;
    const cw = o.w / cols;
    let y = o.y;
    ctx.strokeStyle = "rgba(17,24,39,0.45)";
    ctx.lineWidth = 1;
    rows.forEach((row, r) => {
      const laid = row.map((html) => htmlToBlocks(r === 0 ? `<b>${html}</b>` : html));
      // Höhe messen (unsichtbar zeichnen wäre teurer) → Zeilenhöhe = max(44, Inhalt)
      const m = document.createElement("canvas").getContext("2d")!;
      const h = Math.max(44, ...laid.map((b) => drawBlocks(m, b, 0, 0, cw - 16) + 8));
      if (r === 0) {
        ctx.fillStyle = "rgba(17,24,39,0.05)";
        ctx.fillRect(o.x, y, o.w, h);
      }
      laid.forEach((b, c) => {
        drawBlocks(ctx, b, o.x + c * cw + 8, y + 4, cw - 16);
        ctx.strokeRect(o.x + c * cw, y, cw, h);
      });
      y += h;
    });
  });
}
