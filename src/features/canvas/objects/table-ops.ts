import type { TableData } from "@/canvas/core/objects";

/** Reine Tabellen-Operationen (unveränderlich) – wie in LibreOffice Writer: Zeilen/Spalten einfügen,
 *  löschen, verschieben, sortieren, Spaltenbreiten, Kopfzeile, Zellfarben, Summe. */

export const MAX_ROWS = 100;
export const MAX_COLS = 20;
/** Kleinste Spaltenbreite (Anteil) beim Ziehen. */
export const MIN_COL = 0.04;

export function newTable(rows: number, cols: number): TableData {
  const r = clamp(Math.round(rows), 1, MAX_ROWS), c = clamp(Math.round(cols), 1, MAX_COLS);
  return { cells: Array.from({ length: r }, () => Array<string>(c).fill("")) };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

export function colCount(t: TableData) {
  return t.cells[0]?.length ?? 1;
}

/** Spaltenbreiten als Anteile (Summe 1); fehlend/ungültig → gleichmäßig. */
export function colWidths(t: TableData): number[] {
  const n = colCount(t);
  const w = t.cols;
  if (!w || w.length !== n || w.some((x) => !(x > 0))) return Array(n).fill(1 / n);
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}

/** Trennlinie zwischen Spalte `i` und `i+1` um `delta` (Anteil) verschieben; Gesamtbreite bleibt. */
export function resizeCol(t: TableData, i: number, delta: number): TableData {
  const w = colWidths(t);
  if (i < 0 || i >= w.length - 1) return t;
  const sum = w[i] + w[i + 1];
  const a = clamp(w[i] + delta, MIN_COL, sum - MIN_COL);
  w[i] = a;
  w[i + 1] = sum - a;
  return { ...t, cols: w };
}

export function distributeCols(t: TableData): TableData {
  const { cols: _, ...rest } = t;
  return rest;
}

/** Optimale Breite: Anteile nach längstem Inhalt je Spalte (min. 3 Zeichen). */
export function fitCols(t: TableData): TableData {
  const n = colCount(t);
  const len = Array.from({ length: n }, (_, c) =>
    Math.max(3, ...t.cells.map((row) => plain(row[c] ?? "").split("\n").reduce((m, l) => Math.max(m, l.length), 0))));
  const s = len.reduce((a, b) => a + b, 0);
  return { ...t, cols: len.map((l) => l / s) };
}

const empty = (n: number) => Array<string>(n).fill("");

function mapBg(t: TableData, f: (bg: (string | null)[][]) => (string | null)[][]): Partial<TableData> {
  return t.bg ? { bg: f(t.bg) } : {};
}

function bgRows(t: TableData): (string | null)[][] {
  const n = colCount(t);
  return t.cells.map((_, r) => Array.from({ length: n }, (_, c) => t.bg?.[r]?.[c] ?? null));
}

export function insertRow(t: TableData, at: number): TableData {
  if (t.cells.length >= MAX_ROWS) return t;
  const i = clamp(at, 0, t.cells.length), n = colCount(t);
  const cells = [...t.cells.slice(0, i), empty(n), ...t.cells.slice(i)];
  return { ...t, cells, ...mapBg(t, () => { const b = bgRows(t); b.splice(i, 0, Array(n).fill(null)); return b; }) };
}

export function deleteRow(t: TableData, r: number): TableData {
  if (t.cells.length <= 1) return t;
  return { ...t, cells: t.cells.filter((_, i) => i !== r), ...mapBg(t, () => bgRows(t).filter((_, i) => i !== r)) };
}

export function moveRow(t: TableData, r: number, dir: -1 | 1): TableData {
  const j = r + dir;
  if (r < 0 || j < 0 || j >= t.cells.length) return t;
  const swap = <T,>(a: T[]) => { const b = [...a]; [b[r], b[j]] = [b[j], b[r]]; return b; };
  return { ...t, cells: swap(t.cells), ...mapBg(t, () => swap(bgRows(t))) };
}

export function insertCol(t: TableData, at: number): TableData {
  const n = colCount(t);
  if (n >= MAX_COLS) return t;
  const i = clamp(at, 0, n);
  const ins = <T,>(row: T[], v: T) => [...row.slice(0, i), v, ...row.slice(i)];
  // Neue Spalte bekommt eine Durchschnittsbreite, die übrigen schrumpfen anteilig
  const cols = t.cols ? ins(colWidths(t), 1 / n) : undefined;
  return {
    ...t,
    cells: t.cells.map((row) => ins(row, "")),
    ...(cols ? { cols } : {}),
    ...mapBg(t, () => bgRows(t).map((row) => ins(row, null))),
  };
}

export function deleteCol(t: TableData, c: number): TableData {
  if (colCount(t) <= 1) return t;
  const cols = t.cols ? colWidths(t).filter((_, i) => i !== c) : undefined;
  return {
    ...t,
    cells: t.cells.map((row) => row.filter((_, i) => i !== c)),
    ...(cols ? { cols } : {}),
    ...mapBg(t, () => bgRows(t).map((row) => row.filter((_, i) => i !== c))),
  };
}

export function setCell(t: TableData, r: number, c: number, html: string): TableData {
  if (t.cells[r]?.[c] === html) return t;
  return { ...t, cells: t.cells.map((row, i) => (i === r ? row.map((v, j) => (j === c ? html : v)) : row)) };
}

export function clearRow(t: TableData, r: number): TableData {
  return { ...t, cells: t.cells.map((row, i) => (i === r ? empty(row.length) : row)) };
}

export function clearCol(t: TableData, c: number): TableData {
  return { ...t, cells: t.cells.map((row) => row.map((v, j) => (j === c ? "" : v))) };
}

/** Zellhintergrund für eine Zeile, Spalte oder Zelle (null = keiner). */
export function setBg(t: TableData, rows: number[], cols: number[], color: string | null): TableData {
  const bg = bgRows(t);
  for (const r of rows) for (const c of cols) if (bg[r] && c < bg[r].length) bg[r][c] = color;
  return { ...t, bg: bg.every((row) => row.every((v) => !v)) ? undefined : bg };
}

export function hasHeader(t: TableData) {
  return t.header !== false;
}

export function toggleHeader(t: TableData): TableData {
  return { ...t, header: !hasHeader(t) };
}

/** Text einer Zelle (für Sortieren, Summe, Umwandeln). */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Deutsche Zahl („1.234,5“, „3,5“, „-2“, „12 €“) → number; sonst null. */
export function parseNum(s: string): number | null {
  const t = s.replace(/[\s€%]/g, "");
  if (!/^[+-]?[\d.,]+$/.test(t)) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : null;
}

export function formatNum(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 6 });
}

/** Zeilen nach Spalte `c` sortieren (Zahlen numerisch, sonst deutsch alphabetisch); Kopfzeile bleibt oben. */
export function sortBy(t: TableData, c: number, desc = false): TableData {
  const start = hasHeader(t) ? 1 : 0;
  const bg = bgRows(t);
  const idx = t.cells.map((_, i) => i).slice(start);
  const coll = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
  idx.sort((a, b) => {
    const x = plain(t.cells[a][c] ?? ""), y = plain(t.cells[b][c] ?? "");
    // Leere Zellen immer ans Ende
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    const nx = parseNum(x), ny = parseNum(y);
    const d = nx != null && ny != null ? nx - ny : coll.compare(x, y);
    return desc ? -d : d;
  });
  const order = [...t.cells.map((_, i) => i).slice(0, start), ...idx];
  return { ...t, cells: order.map((i) => t.cells[i]), ...(t.bg ? { bg: order.map((i) => bg[i]) } : {}) };
}

/** Summe der Zahlen oberhalb von Zeile `r` in Spalte `c` (wie AutoSumme). */
export function sumAbove(t: TableData, r: number, c: number): number {
  let s = 0;
  for (let i = 0; i < r; i++) s += parseNum(plain(t.cells[i]?.[c] ?? "")) ?? 0;
  return s;
}

/** Tabelle → Textzeilen (Zellen mit Tab getrennt), für „Tabelle in Text umwandeln“. */
export function tableToText(t: TableData): string {
  return t.cells.map((row) => row.map((h) => plain(h).replace(/\n/g, " ")).join("\t")).join("\n");
}

/** Tab-/Semikolon-getrennten Text (z. B. aus Excel kopiert) als Tabelle; null, wenn es keine ist. */
export function textToTable(text: string): TableData | null {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 1) return null;
  const sep = lines.every((l) => l.includes("\t")) ? "\t" : lines.length > 1 && lines.every((l) => l.includes(";")) ? ";" : null;
  if (!sep) return null;
  const rows = lines.slice(0, MAX_ROWS).map((l) => l.split(sep).slice(0, MAX_COLS));
  const n = Math.max(...rows.map((r) => r.length));
  const esc = (s: string) => s.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return { cells: rows.map((r) => Array.from({ length: n }, (_, i) => esc(r[i] ?? ""))) };
}
