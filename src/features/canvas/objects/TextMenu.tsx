import type { ReactNode } from "react";
import {
  AArrowDown, AArrowUp, AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowDownZA, ArrowUp, ArrowUpAZ,
  BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, Bold, CalendarDays, CaseSensitive,
  ClipboardPaste, Clock, Columns3, Copy, Eraser, Heading1, Heading2, Highlighter, IndentDecrease, IndentIncrease, Italic,
  List, ListOrdered, Minus, MoveHorizontal, Omega, PaintBucket, Palette, Pilcrow, RemoveFormatting, Rows3, Scissors, Sigma,
  Strikethrough, Subscript, Superscript, Table, TextSelect, Trash2, Type, Underline,
} from "lucide-react";
import type { CanvasEngine } from "@/canvas/core/engine";
import { makeObj, type TableData } from "@/canvas/core/objects";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import * as T from "./table-ops";
import { COLORS } from "./FormatBar";

/** Wo das Kontextmenü geöffnet wurde: Textfeld oder Tabellenzelle, mit gemerkter Markierung. */
export interface MenuTarget {
  x: number;
  y: number;
  objId: string;
  el: HTMLElement;
  range: Range | null;
  cell?: { r: number; c: number };
}

/** Marker-/Zellfarben (hell; im Dunkelmodus abgeschwächt dargestellt). */
export const MARKS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa"];
const MARK_NAMES = ["Gelb", "Grün", "Blau", "Rot", "Lila", "Orange"];
const SYMBOLS = ["→", "⇒", "⇔", "≈", "≠", "≤", "≥", "±", "·", "×", "÷", "√", "∞", "°", "²", "³", "½", "π", "α", "β", "γ", "Δ", "Σ", "€", "§", "✓", "✗", "•"];

/** Markierung merken (vor dem Öffnen des Menüs, das den Fokus übernimmt). */
export function captureRange(el: HTMLElement): Range | null {
  const s = window.getSelection();
  if (!s?.rangeCount) return null;
  const r = s.getRangeAt(0);
  return el.contains(r.commonAncestorContainer) ? r.cloneRange() : null;
}

function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

/** Groß-/Kleinschreibung (wie LibreOffice Format → Groß-/Kleinschreibung). */
export function recase(s: string, mode: "upper" | "lower" | "sentence" | "title" | "toggle"): string {
  switch (mode) {
    case "upper": return s.toLocaleUpperCase("de-DE");
    case "lower": return s.toLocaleLowerCase("de-DE");
    case "sentence": return s.toLocaleLowerCase("de-DE").replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("de-DE"));
    case "title": return s.toLocaleLowerCase("de-DE").replace(/(^|[\s\-–(„"])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("de-DE"));
    case "toggle": return [...s].map((ch) => (ch === ch.toLocaleUpperCase("de-DE") ? ch.toLocaleLowerCase("de-DE") : ch.toLocaleUpperCase("de-DE"))).join("");
  }
}

export function TextMenu({ target, engine, onClose, onEditing, onToTable, onToText }: {
  target: MenuTarget | null;
  engine: CanvasEngine | null;
  onClose: () => void;
  onEditing: (id: string | null) => void;
  /** Textfeld → Tabelle bzw. Tabelle → Textfeld. */
  onToTable: (id: string) => void;
  onToText: (id: string) => void;
}) {
  const t = target;
  const obj = t ? engine?.store.getObj(t.objId) : undefined;
  const table = obj?.kind === "table" ? obj : null;
  const text = obj?.kind === "text" ? obj : null;
  const hasSel = !!t?.range && !t.range.collapsed;

  /** Fokus und Markierung zurück ins Feld, dann Befehl ausführen. */
  const restore = () => {
    if (!t) return;
    t.el.focus({ preventScroll: true });
    const s = window.getSelection();
    if (t.range && s) {
      s.removeAllRanges();
      s.addRange(t.range);
    }
  };
  const run = (f: () => void) => () => {
    restore();
    f();
  };
  /** Ohne Markierung gilt der Befehl für das Wort an der Schreibmarke (wie in LibreOffice). */
  const word = () => {
    const s = window.getSelection();
    if (!s || !s.isCollapsed || !s.modify) return;
    s.modify("move", "backward", "word");
    s.modify("extend", "forward", "word");
  };
  const caseTo = (mode: Parameters<typeof recase>[1]) => run(() => {
    word();
    const s = window.getSelection()?.toString();
    if (s) exec("insertText", recase(s, mode));
  });
  const paste = () => {
    void navigator.clipboard?.readText().then((txt) => {
      restore();
      if (txt) exec("insertText", txt);
    }, () => restore());
  };

  // ---- Tabelle ----
  const tbl = (f: (d: TableData) => TableData, focus?: { r: number; c: number }) => () => {
    const cur = engine?.store.getObj(t!.objId);
    if (!engine || cur?.kind !== "table") return;
    const data = f(cur.data);
    if (data === cur.data) return;
    const after = makeObj({ ...cur, data });
    engine.updateObjectLive(after);
    engine.recordObjectEdit(cur, after);
    if (focus) focusCell(cur.id, focus.r, focus.c);
  };
  const r = t?.cell?.r ?? 0, c = t?.cell?.c ?? 0;
  const d = table?.data;
  const rows = d?.cells.length ?? 0, cols = d ? T.colCount(d) : 0;
  const bgMenu = (label: string, rs: number[], cs: number[]) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent data-format-bar>
        <Swatches colors={MARKS} names={MARK_NAMES} onPick={(col) => tbl((x) => T.setBg(x, rs, cs, col))()} />
        <DropdownMenuItem onSelect={tbl((x) => T.setBg(x, rs, cs, null))}><Eraser /> Keine Farbe</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  return (
    <DropdownMenu open={!!t} onOpenChange={(o) => !o && onClose()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: t?.x ?? 0, top: t?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent data-format-bar data-testid="text-menu" align="start" collisionPadding={8} className="w-64"
        aria-label={table ? "Tabellenmenü" : "Textmenü"}
        onCloseAutoFocus={(e) => e.preventDefault() /* Schreibmarke bleibt im Feld */}>
        <DropdownMenuItem disabled={!hasSel} onSelect={run(() => exec("cut"))}><Scissors /> Ausschneiden<DropdownMenuShortcut>Strg+X</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled={!hasSel} onSelect={run(() => exec("copy"))}><Copy /> Kopieren<DropdownMenuShortcut>Strg+C</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onSelect={paste}><ClipboardPaste /> Einfügen<DropdownMenuShortcut>Strg+V</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onSelect={run(() => exec("selectAll"))}><TextSelect /> Alles auswählen<DropdownMenuShortcut>Strg+A</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Type /> Zeichen</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-format-bar className="w-60">
            <DropdownMenuItem onSelect={run(() => exec("bold"))}><Bold /> Fett<DropdownMenuShortcut>Strg+B</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("italic"))}><Italic /> Kursiv<DropdownMenuShortcut>Strg+I</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("underline"))}><Underline /> Unterstrichen<DropdownMenuShortcut>Strg+U</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("strikeThrough"))}><Strikethrough /> Durchgestrichen<DropdownMenuShortcut>Strg+D</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("superscript"))}><Superscript /> Hochgestellt<DropdownMenuShortcut>Strg+⇧+P</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("subscript"))}><Subscript /> Tiefgestellt<DropdownMenuShortcut>Strg+⇧+B</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => exec("increaseFontSize"))}><AArrowUp /> Schrift größer<DropdownMenuShortcut>Strg+]</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("decreaseFontSize"))}><AArrowDown /> Schrift kleiner<DropdownMenuShortcut>Strg+[</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => { exec("removeFormat"); exec("unlink"); })}><RemoveFormatting /> Formatierung entfernen<DropdownMenuShortcut>Strg+M</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Palette /> Farbe</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-format-bar>
            <DropdownMenuLabel>Textfarbe</DropdownMenuLabel>
            <Swatches colors={COLORS} onPick={(col) => run(() => exec("foreColor", col))()} />
            <DropdownMenuLabel className="flex items-center gap-2"><Highlighter className="size-4" /> Hervorheben</DropdownMenuLabel>
            <Swatches colors={MARKS} names={MARK_NAMES} onPick={(col) => run(() => exec("hiliteColor", col))()} />
            <DropdownMenuItem onSelect={run(() => exec("hiliteColor", "transparent"))}><Eraser /> Keine Hervorhebung</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Pilcrow /> Absatz</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-format-bar className="w-60">
            <DropdownMenuItem onSelect={run(() => exec("justifyLeft"))}><AlignLeft /> Linksbündig<DropdownMenuShortcut>Strg+L</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("justifyCenter"))}><AlignCenter /> Zentriert<DropdownMenuShortcut>Strg+E</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("justifyRight"))}><AlignRight /> Rechtsbündig<DropdownMenuShortcut>Strg+R</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("justifyFull"))}><AlignJustify /> Blocksatz<DropdownMenuShortcut>Strg+J</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => exec("indent"))}><IndentIncrease /> Einzug vergrößern</DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("outdent"))}><IndentDecrease /> Einzug verkleinern</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => exec("formatBlock", "<h1>"))}><Heading1 /> Überschrift 1<DropdownMenuShortcut>Strg+1</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("formatBlock", "<h2>"))}><Heading2 /> Überschrift 2<DropdownMenuShortcut>Strg+2</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("formatBlock", "<p>"))}><Pilcrow /> Normaler Text<DropdownMenuShortcut>Strg+0</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={run(() => exec("insertUnorderedList"))}><List /> Aufzählung</DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("insertOrderedList"))}><ListOrdered /> Nummerierung</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><CaseSensitive /> Groß-/Kleinschreibung</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-format-bar>
            <DropdownMenuItem onSelect={caseTo("sentence")}>Satzanfang groß</DropdownMenuItem>
            <DropdownMenuItem onSelect={caseTo("lower")}>kleinbuchstaben</DropdownMenuItem>
            <DropdownMenuItem onSelect={caseTo("upper")}>GROSSBUCHSTABEN</DropdownMenuItem>
            <DropdownMenuItem onSelect={caseTo("title")}>Jedes Wort Groß</DropdownMenuItem>
            <DropdownMenuItem onSelect={caseTo("toggle")}>gROSS/kLEIN uMKEHREN</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Omega /> Datum, Symbol einfügen</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-format-bar className="w-64">
            <DropdownMenuItem onSelect={run(() => exec("insertText", new Date().toLocaleDateString("de-DE")))}><CalendarDays /> Datum</DropdownMenuItem>
            <DropdownMenuItem onSelect={run(() => exec("insertText", new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })))}><Clock /> Uhrzeit</DropdownMenuItem>
            {!table && <DropdownMenuItem onSelect={run(() => exec("insertHorizontalRule"))}><Minus /> Trennlinie</DropdownMenuItem>}
            <DropdownMenuLabel>Sonderzeichen</DropdownMenuLabel>
            <div role="group" aria-label="Sonderzeichen" className="grid grid-cols-5 gap-0.5 p-1">
              {SYMBOLS.map((s) => (
                <DropdownMenuItem key={s} aria-label={`${s} einfügen`} onSelect={run(() => exec("insertText", s))}
                  className="size-11 justify-center p-0 text-lg">{s}</DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {table && d && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Tabelle · Zeile {r + 1}, Spalte {c + 1}</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><BetweenHorizontalStart /> Zeile/Spalte einfügen</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-format-bar className="w-60">
                <DropdownMenuItem disabled={rows >= T.MAX_ROWS} onSelect={tbl((x) => T.insertRow(x, r), { r, c })}><BetweenHorizontalStart /> Zeile oberhalb</DropdownMenuItem>
                <DropdownMenuItem disabled={rows >= T.MAX_ROWS} onSelect={tbl((x) => T.insertRow(x, r + 1), { r: r + 1, c })}><BetweenHorizontalEnd /> Zeile unterhalb</DropdownMenuItem>
                <DropdownMenuItem disabled={cols >= T.MAX_COLS} onSelect={tbl((x) => T.insertCol(x, c), { r, c })}><BetweenVerticalStart /> Spalte links</DropdownMenuItem>
                <DropdownMenuItem disabled={cols >= T.MAX_COLS} onSelect={tbl((x) => T.insertCol(x, c + 1), { r, c: c + 1 })}><BetweenVerticalEnd /> Spalte rechts</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Trash2 /> Zeile/Spalte löschen</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-format-bar className="w-56">
                <DropdownMenuItem disabled={rows <= 1} onSelect={tbl((x) => T.deleteRow(x, r), { r: Math.min(r, rows - 2), c })}><Rows3 /> Zeile</DropdownMenuItem>
                <DropdownMenuItem disabled={cols <= 1} onSelect={tbl((x) => T.deleteCol(x, c), { r, c: Math.min(c, cols - 2) })}><Columns3 /> Spalte</DropdownMenuItem>
                <DropdownMenuItem onSelect={tbl((x) => T.clearRow(x, r))}><Eraser /> Zeileninhalt</DropdownMenuItem>
                <DropdownMenuItem onSelect={tbl((x) => T.clearCol(x, c))}><Eraser /> Spalteninhalt</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => { engine?.removeObject(t!.objId); onEditing(null); }}><Trash2 /> Ganze Tabelle</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Rows3 /> Zeilen & Spalten</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-format-bar className="w-64">
                <DropdownMenuItem disabled={r <= 0} onSelect={tbl((x) => T.moveRow(x, r, -1), { r: r - 1, c })}><ArrowUp /> Zeile nach oben<DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem disabled={r >= rows - 1} onSelect={tbl((x) => T.moveRow(x, r, 1), { r: r + 1, c })}><ArrowDown /> Zeile nach unten<DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={tbl(T.distributeCols)}><Columns3 /> Spalten gleichmäßig verteilen</DropdownMenuItem>
                <DropdownMenuItem onSelect={tbl(T.fitCols)}><MoveHorizontal /> Optimale Spaltenbreite</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={T.hasHeader(d)} onSelect={tbl(T.toggleHeader)}>Kopfzeile hervorheben</DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><ArrowUpAZ /> Sortieren</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-format-bar className="w-60">
                <DropdownMenuItem onSelect={tbl((x) => T.sortBy(x, c))}><ArrowUpAZ /> Aufsteigend nach Spalte {c + 1}</DropdownMenuItem>
                <DropdownMenuItem onSelect={tbl((x) => T.sortBy(x, c, true))}><ArrowDownZA /> Absteigend nach Spalte {c + 1}</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><PaintBucket /> Zellhintergrund</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-format-bar>
                {bgMenu("Diese Zelle", [r], [c])}
                {bgMenu("Ganze Zeile", [r], [...Array(cols).keys()])}
                {bgMenu("Ganze Spalte", [...Array(rows).keys()], [c])}
                <DropdownMenuItem onSelect={tbl((x) => ({ ...x, bg: undefined }))}><Eraser /> Alle Farben entfernen</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={r === 0} onSelect={tbl((x) => T.setCell(x, r, c, T.formatNum(T.sumAbove(x, r, c))))}>
              <Sigma /> Summe der Zellen darüber
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToText(t!.objId)}><Type /> In Textfeld umwandeln</DropdownMenuItem>
          </>
        )}

        {text && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={!!text.data.auto} onSelect={() => {
              const cur = engine?.store.getObj(t!.objId);
              if (!engine || cur?.kind !== "text") return;
              const after = makeObj({ ...cur, data: { ...cur.data, auto: !cur.data.auto } });
              engine.updateObjectLive(after);
              engine.recordObjectEdit(cur, after);
            }}>Breite automatisch anpassen</DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={() => onToTable(t!.objId)}><Table /> In Tabelle umwandeln<DropdownMenuShortcut>Tab</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => { engine?.removeObject(t!.objId); onEditing(null); }}><Trash2 /> Textfeld löschen</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Swatches({ colors, names, onPick }: { colors: string[]; names?: string[]; onPick: (c: string) => void }): ReactNode {
  return (
    <div role="group" className="flex flex-wrap gap-0.5 px-1 pb-1">
      {colors.map((col, i) => (
        <DropdownMenuItem key={col} aria-label={names?.[i] ?? col} title={names?.[i] ?? col} onSelect={() => onPick(col)}
          className={cn("size-11 justify-center p-0")}>
          <span className="size-6 rounded-full border border-black/15" style={{ background: col }} />
        </DropdownMenuItem>
      ))}
    </div>
  );
}

/** Nach einer Strukturänderung die passende Zelle fokussieren. */
export function focusCell(id: string, r: number, c: number) {
  const go = () => {
    const td = document.querySelector<HTMLElement>(`[data-id="${id}"] tr:nth-child(${r + 1}) > td:nth-child(${c + 1})`);
    if (!td || td.contentEditable !== "true") return false;
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
    return true;
  };
  // Vorhandene Zelle sofort (schnelles Weitertippen nach Tab), neue erst nach dem Rendern
  if (!go()) window.setTimeout(go, 30);
}
