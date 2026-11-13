import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, GripHorizontal, MoveHorizontal, Minus, Plus, Trash2 } from "lucide-react";
import type { CanvasEngine } from "@/canvas/core/engine";
import { makeObj, type CanvasObj, type TableData, type TableObj, type TextObj } from "@/canvas/core/objects";
import type { BBox, ElementTag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tagIcon, useTagStore } from "@/features/tags/tag-store";
import { isBlankHtml, linkifyHtml, sanitizeHtml } from "./sanitize";
import { MathView } from "@/features/recognition/Math";
import * as T from "./table-ops";
import { captureRange, focusCell, TextMenu, type MenuTarget } from "./TextMenu";

/** Variable Textfelder (OneNote): kleinste und größte automatische Breite (Welt-px). */
export const AUTO_MIN_W = 120;
export const AUTO_MAX_W = 640;

export interface TagAnchor { id: string; bbox: BBox; tags: ElementTag[] }

export interface ObjectLayerProps {
  objects: CanvasObj[];
  engine: CanvasEngine | null;
  /** Textwerkzeug aktiv → Objekte sind bedienbar. */
  interactive: boolean;
  editingId: string | null;
  onEditing: (id: string | null) => void;
  layerRef: (el: HTMLDivElement | null) => void;
  dark: boolean;
  /** Tags je Element-ID. */
  tags: Map<string, ElementTag[]>;
  /** Positionen der markierten Elemente (Welt). */
  anchors: TagAnchor[];
  onTag: (elementId: string, tagId: string, on: boolean) => void;
  onTagDone: (elementId: string, tagId: string, done: boolean) => void;
  onLink: (title: string) => void;
  /** Formel antippen (Textwerkzeug) → LaTeX-Dialog. */
  onEditLatex?: (o: TextObj) => void;
  /** Objekt unter der Maus/lange gedrückt: Greifbalken zeigen */
  hoverId?: string | null;
}

/** DOM-Ebene für Textcontainer und Tabellen; Kamera-Transform setzt die Engine direkt. */
export function ObjectLayer(p: ObjectLayerProps) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const q = { ...p, onMenu: setMenu };
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={p.layerRef} data-testid="object-layer" className="absolute top-0 left-0 origin-top-left" style={{ width: 0, height: 0 }}
        onPointerDownCapture={(e) => {
          const a = (e.target as HTMLElement).closest?.("a[data-link]");
          if (!a) return;
          e.preventDefault();
          e.stopPropagation();
          p.onLink(a.getAttribute("data-link") ?? "");
        }}
        onClickCapture={(e) => (e.target as HTMLElement).closest?.("a[data-link]") && e.preventDefault()}>
        {p.anchors.map((a) => <TagBadges key={a.id} anchor={a} onDone={p.onTagDone} />)}
        {p.objects.map((o) =>
          o.kind === "text" && o.data.latex != null ? (
            <MathBox key={o.id} obj={o} {...q} />
          ) : o.kind === "text" ? (
            <TextBox key={o.id} obj={o} {...q} />
          ) : o.kind === "table" ? (
            <TableBox key={o.id} obj={o} {...q} />
          ) : null,
        )}
      </div>
      {createPortal(
        <TextMenu target={menu} engine={p.engine} onClose={() => setMenu(null)} onEditing={p.onEditing}
          onToTable={(id) => p.engine && textToTableObj(p.engine, id, p.onEditing)}
          onToText={(id) => p.engine && tableToTextObj(p.engine, id, p.onEditing)} />,
        document.body,
      )}
    </div>
  );
}

type BoxProps<T> = ObjectLayerProps & { obj: T; onMenu: (t: MenuTarget) => void };

/** Textfeld → Tabelle: Zeilen werden Tabellenzeilen; Tab/Semikolon trennt Spalten, sonst 2 Spalten. */
function textToTableObj(engine: CanvasEngine, id: string, onEditing: (id: string | null) => void, el?: HTMLElement | null) {
  const cur = engine.store.getObj(id);
  if (cur?.kind !== "text") return;
  const txt = el?.innerText ?? T.plain(cur.data.html);
  const parsed = T.textToTable(txt);
  const lines = txt.split("\n").map((l) => l.trim()).filter(Boolean);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cells = parsed?.cells ?? (lines.length ? lines.map((l) => [esc(l), ""]) : T.newTable(2, 2).cells);
  const table = makeObj<TableObj>({ id: cur.id + "-t", kind: "table", z: cur.z, x: cur.x, y: cur.y, w: Math.max(cur.w, 320), h: 44 * cells.length, angle: cur.angle, data: { cells } });
  engine.replaceObject(cur, table);
  onEditing(table.id);
  focusCell(table.id, 0, Math.min(1, cells[0].length - 1));
}

/** Tabelle → Textfeld (Zellen mit „; “ getrennt, lässt sich mit Tab zurückwandeln). */
function tableToTextObj(engine: CanvasEngine, id: string, onEditing: (id: string | null) => void) {
  const cur = engine.store.getObj(id);
  if (cur?.kind !== "table") return;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = cur.data.cells.map((row) => row.map((h) => esc(T.plain(h).replace(/\n/g, " "))).join("; ")).join("<br>");
  const text = makeObj<TextObj>({ id: cur.id + "-x", kind: "text", z: cur.z, x: cur.x, y: cur.y, w: cur.w, h: cur.h, angle: cur.angle, data: { html, auto: true } });
  engine.replaceObject(cur, text);
  onEditing(text.id);
}

/** Tastenkürzel wie in LibreOffice Writer (zusätzlich zu Strg+B/I/U des Browsers). */
function richKeys(e: React.KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  const cmd: [string, string?] | null =
    e.shiftKey ? (k === "p" ? ["superscript"] : k === "b" ? ["subscript"] : null)
    : k === "e" ? ["justifyCenter"] : k === "l" ? ["justifyLeft"] : k === "r" ? ["justifyRight"] : k === "j" ? ["justifyFull"]
    : k === "d" ? ["strikeThrough"] : k === "m" ? ["removeFormat"] : k === "]" ? ["increaseFontSize"] : k === "[" ? ["decreaseFontSize"]
    : k === "1" ? ["formatBlock", "<h1>"] : k === "2" ? ["formatBlock", "<h2>"] : k === "0" ? ["formatBlock", "<p>"] : null;
  if (!cmd) return false;
  e.preventDefault();
  document.execCommand(cmd[0], false, cmd[1]);
  return true;
}

/** Rechtsklick / langes Drücken im Text → eigenes Kontextmenü. */
function openMenu(e: React.MouseEvent, objId: string, onMenu: (t: MenuTarget) => void, cell?: { r: number; c: number }) {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[contenteditable=true]");
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  // Rechtsklick ohne Markierung: Schreibmarke an die Klickstelle setzen
  const s = window.getSelection();
  if (s && (s.isCollapsed || !el.contains(s.anchorNode)) && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r && el.contains(r.startContainer)) {
      el.focus({ preventScroll: true });
      s.removeAllRanges();
      s.addRange(r);
    }
  }
  onMenu({ x: e.clientX, y: e.clientY, objId, el, range: captureRange(el), cell });
}

/** Gemeinsamer Rahmen: Verschiebegriff, Breite ändern, Löschen. */
function Frame({ obj, engine, interactive, editingId, hoverId, onEditing, children, label }: BoxProps<CanvasObj> & { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = editingId === obj.id;
  const [held, setHeld] = useState(false);
  const hovered = hoverId === obj.id || held;
  const live = interactive || active || hovered;

  const auto = obj.kind === "text" && !!obj.data.auto && obj.data.latex == null;
  // Höhe (und bei variablen Textfeldern die Breite) an den Inhalt anpassen (ohne Verlauf)
  useEffect(() => {
    const el = ref.current;
    if (!el || !engine) return;
    const ro = new ResizeObserver(() => {
      const cur = engine.store.getObj(obj.id);
      if (!cur) return;
      const h = el.offsetHeight, w = el.offsetWidth;
      const isAuto = cur.kind === "text" && !!cur.data.auto;
      if (Math.abs(h - cur.h) > 1 || (isAuto && Math.abs(w - cur.w) > 1)) engine.updateObjectLive(makeObj({ ...cur, h, w: isAuto ? w : cur.w }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine, obj.id]);

  const drag = (e: React.PointerEvent, kind: "move" | "width") => {
    if (!engine) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const before = engine.store.getObj(obj.id);
    if (!before) return;
    const scale = engine.zoom;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale, dy = (ev.clientY - y0) / scale;
      const next = kind === "move"
        ? makeObj({ ...before, x: before.x + dx, y: before.y + dy })
        // Breite von Hand ändern → feste Breite (kein automatisches Wachsen mehr)
        : makeObj({ ...before, w: Math.max(80, before.w + dx), ...(before.kind === "text" ? { data: { ...before.data, auto: false } } : {}) });
      engine.updateObjectLive(next as CanvasObj);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const after = engine.store.getObj(obj.id);
      if (after) engine.recordObjectEdit(before, after);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const startMove = (el: HTMLElement, pointerId: number, x0: number, y0: number) => {
    if (!engine) return;
    const before = engine.store.getObj(obj.id);
    if (!before) return;
    try { el.setPointerCapture(pointerId); } catch { /* Zeiger schon losgelassen */ }
    el.style.cursor = "grabbing";
    const scale = engine.zoom;
    // Eingerastete Textfelder bleiben beim Verschieben auf den Linien (Grundlinie) bzw. Kästchen
    const lh = before.kind === "text" ? before.data.lh : undefined;
    const grid = before.kind === "text" && before.data.padX === 0;
    // Alt gedrückt → frei verschieben (kein Einrasten)
    const snap = (d: number, on: boolean, alt: boolean) => (lh && on && !alt ? Math.round(d / lh) * lh : d);
    const move = (ev: PointerEvent) => {
      const dx = snap((ev.clientX - x0) / scale, grid, ev.altKey), dy = snap((ev.clientY - y0) / scale, true, ev.altKey);
      engine.updateObjectLive(makeObj({ ...before, x: before.x + dx, y: before.y + dy }) as CanvasObj);
    };
    const up = () => {
      el.style.cursor = "";
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const after = engine.store.getObj(obj.id);
      if (after) engine.recordObjectEdit(before, after);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div
      ref={ref}
      data-obj={obj.kind}
      data-id={obj.id}
      aria-label={label}
      className={cn(
        "absolute rounded-sm",
        live ? "pointer-events-auto" : "pointer-events-none",
        active && "rounded-b-md ring-1 ring-border shadow-sm",
      )}
      style={{
        left: obj.x, top: obj.y, transform: obj.angle ? `rotate(${obj.angle}rad)` : undefined,
        // OneNote: Feld wächst beim Tippen nach rechts, ab AUTO_MAX_W wird umbrochen
        ...(auto ? { width: "max-content", minWidth: AUTO_MIN_W, maxWidth: AUTO_MAX_W } : { width: obj.w }),
      }}
      onPointerEnter={() => hovered && setHeld(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHeld(false)}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (engine?.isPalmTouch(e)) { e.preventDefault(); return; } // Handballen beim Schreiben
        if (!active) onEditing(obj.id);
        // Gedrückt halten → verschieben (kurzes Antippen bleibt Bearbeiten/Markieren)
        const x0 = e.clientX, y0 = e.clientY, el = e.currentTarget as HTMLElement, id = e.pointerId;
        const cancel = () => { clearTimeout(t); el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", cancel); };
        const mv = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel(); };
        const t = window.setTimeout(() => {
          cancel();
          (document.activeElement as HTMLElement | null)?.blur?.();
          window.getSelection()?.removeAllRanges();
          startMove(el, id, x0, y0);
        }, 380);
        el.addEventListener("pointermove", mv);
        el.addEventListener("pointerup", cancel);
      }}
    >
      {children}
      {active && (
        // Kopfleiste wie in OneNote: ganze Leiste = verschieben, rechts = Breite ändern bzw. löschen
        <div className="absolute inset-x-[-1px] -top-5 flex h-5 cursor-move touch-none items-center rounded-t-md border border-b-0 bg-muted text-muted-foreground after:absolute after:inset-x-0 after:-top-3 after:h-3"
          data-format-bar data-testid="box-header" role="button" aria-label={`${label} verschieben`} title="Ziehen zum Verschieben (Alt: ohne Einrasten)"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            e.preventDefault();
            e.stopPropagation();
            startMove(e.currentTarget, e.pointerId, e.clientX, e.clientY);
          }}>
          <span className="pointer-events-none mx-auto flex items-center"><GripHorizontal className="size-3.5" /></span>
          <button type="button" aria-label={`${label} löschen`} title="Löschen (Entf)" tabIndex={-1} data-testid="box-delete"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { engine?.removeObject(obj.id); onEditing(null); }}
            className="relative flex h-full w-7 items-center justify-center hover:text-destructive after:absolute after:-inset-y-3 after:-inset-x-1">
            <Trash2 className="size-3.5" />
          </button>
          <button type="button" aria-label={`Breite von ${label} ändern`} title="Breite ändern" tabIndex={-1} onPointerDown={(e) => drag(e, "width")}
            className="relative flex h-full w-7 cursor-ew-resize touch-none items-center justify-center after:absolute after:-inset-y-3 after:-inset-x-1">
            <MoveHorizontal className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}

/** innerHTML nur setzen, wenn das Element nicht gerade bearbeitet wird (Anzeige mit Seitenlinks). */
/** „- “, „* “ bzw. „1. “ am Zeilenanfang → Aufzählung bzw. nummerierte Liste (wie in OneNote/Word). */
function autoList(): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const before = (node.textContent ?? "").slice(0, sel.anchorOffset);
  // nur am Anfang eines Absatzes (Textknoten ist erstes Kind seines Blocks)
  const block = node.parentElement?.closest("div, p, li, [role=textbox]");
  if (!block || block.tagName === "LI") return false;
  const first = (() => { let n: Node | null = node; while (n && n.parentNode !== block) n = n.parentNode; return n === block.firstChild || !n?.previousSibling || n.previousSibling.nodeName === "BR"; })();
  if (!first) return false;
  const kind = /^[-*•]$/.test(before) ? "insertUnorderedList" : /^1[.)]$/.test(before) ? "insertOrderedList" : null;
  if (!kind) return false;
  const r = document.createRange();
  r.setStart(node, 0);
  r.setEnd(node, sel.anchorOffset);
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand("delete");
  document.execCommand(kind);
  return true;
}

function useHtml(ref: React.RefObject<HTMLElement | null>, html: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const shown = linkifyHtml(sanitizeHtml(html));
    if (el.innerHTML !== shown) el.innerHTML = shown;
  }, [ref, html]);
}

/** Beim Bearbeiten Links wieder als Klartext `[[…]]` zeigen. */
function unlinkify(el: HTMLElement) {
  if (!el.querySelector("a[data-link]")) return;
  el.innerHTML = sanitizeHtml(el.innerHTML);
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

/** Tag-Symbole links neben einem markierten Element; Größe unabhängig vom Zoom. */
function TagBadges({ anchor, onDone }: { anchor: TagAnchor; onDone: (elementId: string, tagId: string, done: boolean) => void }) {
  const defs = useTagStore((s) => s.tags);
  return (
    <div className="pointer-events-auto absolute flex origin-top-right flex-row-reverse gap-0.5" data-testid="tag-badges"
      style={{ left: anchor.bbox.x - 4, top: anchor.bbox.y, transform: "translateX(-100%) scale(calc(1 / var(--zoom, 1)))", transformOrigin: "100% 0" }}>
      {anchor.tags.map((t) => {
        const d = defs.find((x) => x.id === t.tagId);
        if (!d) return null;
        const I = tagIcon(d.icon);
        if (t.tagId === "todo")
          return (
            <button key={t.tagId} type="button" role="checkbox" aria-checked={t.done} aria-label={`To-Do ${t.done ? "erledigt" : "offen"}`}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => onDone(anchor.id, t.tagId, !t.done)}
              className="flex size-11 items-center justify-center">
              <span className={cn("flex size-6 items-center justify-center rounded border-2 bg-card", t.done && "text-white")}
                style={{ borderColor: d.color, background: t.done ? d.color : undefined }}>
                {t.done && <Check className="size-4" />}
              </span>
            </button>
          );
        return (
          <span key={t.tagId} title={d.name} aria-label={`Tag ${d.name}`} role="img" className="flex size-11 items-center justify-center">
            <I className="size-6" style={{ color: d.color }} />
          </span>
        );
      })}
    </div>
  );
}

/** Einfügen nur als reiner Text (Bilder übernimmt der Canvas). */
function pastePlain(e: React.ClipboardEvent) {
  if ([...e.clipboardData.items].some((i) => i.type.startsWith("image/"))) return;
  e.preventDefault();
  e.stopPropagation();
  document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
}

/** Formel (KaTeX); bearbeitet wird über den LaTeX-Dialog. */
function MathBox(p: BoxProps<TextObj>) {
  const latex = p.obj.data.latex ?? "";
  return (
    <Frame {...p} label="Formel">
      <button type="button" aria-label={`Formel ${latex} bearbeiten`} title="Formel bearbeiten"
        className="block min-h-11 w-full overflow-x-auto px-2 py-1 text-left text-xl text-foreground [&_.katex-display]:my-0 [&_.katex-display]:text-left"
        onClick={() => p.onEditLatex?.(p.obj)}>
        <MathView latex={latex} className="pointer-events-none" />
      </button>
    </Frame>
  );
}

function TextBox(p: BoxProps<TextObj>) {
  const { obj, engine, editingId, onEditing } = p;
  const ed = useRef<HTMLDivElement>(null);
  const before = useRef<CanvasObj | null>(null);
  const timer = useRef(0);
  const active = editingId === obj.id;
  useHtml(ed, obj.data.html);

  useEffect(() => {
    if (active && document.activeElement !== ed.current) ed.current?.focus();
    if (active) return;
    // Leere Textfelder verschwinden, sobald sie nicht mehr bearbeitet werden
    const t = window.setTimeout(() => {
      const cur = engine?.store.getObj(obj.id);
      if (cur?.kind === "text" && isBlankHtml(cur.data.html) && document.activeElement !== ed.current) engine?.removeObject(obj.id);
    }, 400);
    return () => clearTimeout(t);
  }, [active, engine, obj.id]);

  const pushLive = () => {
    clearTimeout(timer.current);
    const cur = engine?.store.getObj(obj.id);
    if (!engine || !cur || cur.kind !== "text" || !ed.current) return;
    const html = sanitizeHtml(ed.current.innerHTML);
    if (html !== cur.data.html) engine.updateObjectLive({ ...cur, data: { ...cur.data, html } });
  };

  return (
    <Frame {...p} label="Textfeld">
      <div
        ref={ed}
        role="textbox"
        aria-multiline="true"
        aria-label="Text"
        contentEditable={p.interactive || active}
        suppressContentEditableWarning
        spellCheck
        lang="de"
        className={cn("nf-rich text-foreground outline-none", obj.data.lh ? "py-0" : "min-h-11 px-2 py-1.5 text-base leading-snug")}
        style={obj.data.lh ? {
          fontSize: obj.data.size, lineHeight: `${obj.data.lh}px`, minHeight: obj.data.lh,
          paddingLeft: obj.data.padX ?? 8, paddingRight: 8,
        } : undefined}
        onFocus={(e) => {
          unlinkify(e.currentTarget);
          before.current = engine?.store.getObj(obj.id) ?? null;
          if (!active) onEditing(obj.id);
        }}
        onInput={() => {
          clearTimeout(timer.current);
          timer.current = window.setTimeout(pushLive, 300);
        }}
        onPaste={(e) => {
          // Tabellarischer Text (z. B. aus Excel/LibreOffice Calc) in ein leeres Feld → Tabelle
          const txt = e.clipboardData.getData("text/plain");
          if (engine && ed.current && isBlankHtml(ed.current.innerHTML) && txt.includes("\t") && T.textToTable(txt)) {
            e.preventDefault();
            e.stopPropagation();
            before.current = null;
            textToTableObj(engine, obj.id, onEditing, Object.assign(document.createElement("div"), { innerText: txt }));
            return;
          }
          pastePlain(e);
        }}
        onContextMenu={(e) => openMenu(e, obj.id, p.onMenu)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.currentTarget as HTMLElement).blur();
          if (richKeys(e)) return;
          if (e.key === " " && autoList()) { e.preventDefault(); return; }
          if (e.key === "Tab" && !e.shiftKey && engine) {
            // Tab macht aus dem Textfeld eine Tabelle (Zeilen → erste Spalte), weiter in Zelle 1/2
            e.preventDefault();
            before.current = null;
            textToTableObj(engine, obj.id, onEditing, ed.current);
          }
        }}
        onBlur={(e) => {
          pushLive();
          const cur = engine?.store.getObj(obj.id);
          const b = before.current;
          before.current = null;
          // Fokus wandert in die eigene Formatleiste/Griffe → weiter bearbeiten
          const next = e.relatedTarget as HTMLElement | null;
          if (next?.closest("[data-format-bar]")) return;
          if (!engine || !cur || cur.kind !== "text") return;
          if (isBlankHtml(cur.data.html)) engine.removeObject(obj.id);
          else if (b) engine.recordObjectEdit(b, cur);
          if (editingId === obj.id) onEditing(null);
        }}
      />
    </Frame>
  );
}

function TableBox(p: BoxProps<TableObj>) {
  const { obj, engine, interactive, editingId, dark } = p;
  const live = interactive || editingId === obj.id;
  const editing = editingId === obj.id;
  const data = obj.data;
  const cells = data.cells;
  const cols = T.colCount(data);
  const widths = T.colWidths(data);
  const header = T.hasHeader(data);

  const commit = (f: (d: TableData) => TableData, focus?: { r: number; c: number }) => {
    const cur = engine?.store.getObj(obj.id);
    if (!engine || !cur || cur.kind !== "table") return;
    const next = f(cur.data);
    if (next === cur.data) return;
    const after = makeObj({ ...cur, data: next });
    engine.updateObjectLive(after);
    engine.recordObjectEdit(cur, after);
    if (focus) focusCell(obj.id, focus.r, focus.c);
  };

  /** Spaltentrenner ziehen (Maus, Stift, Finger); Doppelklick = optimale Breite. */
  const dragCol = (e: React.PointerEvent, i: number) => {
    if (!engine) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const before = engine.store.getObj(obj.id);
    if (before?.kind !== "table") return;
    const x0 = e.clientX, scale = engine.zoom;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - x0) / scale / before.w;
      engine.updateObjectLive(makeObj({ ...before, data: T.resizeCol(before.data, i, delta) }));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const after = engine.store.getObj(obj.id);
      if (after && after !== before) engine.recordObjectEdit(before, after);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  let acc = 0;
  const borders = widths.slice(0, -1).map((w) => (acc += w));

  return (
    <Frame {...p} label="Tabelle">
      <table className="w-full table-fixed border-collapse text-base text-foreground">
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w * 100}%` }} />)}</colgroup>
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>
              {row.map((html, c) => (
                <Cell key={c} html={html} editable={live} header={header && r === 0} bg={data.bg?.[r]?.[c] ?? null} dark={dark}
                  onCommit={(h) => commit((d) => T.setCell(d, r, c, h))} label={`Zelle ${r + 1}, ${c + 1}`}
                  onMenu={(e) => openMenu(e, obj.id, p.onMenu, { r, c })}
                  onMoveRow={(dir) => commit((d) => T.moveRow(d, r, dir), { r: r + dir, c })}
                  onTab={(back) => {
                    const i = r * cols + c + (back ? -1 : 1);
                    if (i >= 0 && i < cells.length * cols) return focusCell(obj.id, Math.floor(i / cols), i % cols);
                    if (back) return;
                    // Tab in der letzten Zelle → neue Zeile (wie in Writer/Word)
                    commit((d) => T.insertRow(d, d.cells.length), { r: r + 1, c: 0 });
                  }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {live && borders.map((b, i) => (
        // Spaltentrenner verschieben; breite unsichtbare Griffzone, damit es auch mit dem Finger geht
        <div key={i} role="separator" aria-orientation="vertical" aria-label={`Breite zwischen Spalte ${i + 1} und ${i + 2} ändern`}
          title="Ziehen: Spaltenbreite · Doppelklick: optimale Breite" data-testid="col-resize"
          className="group absolute top-0 bottom-0 z-10 w-4 -translate-x-1/2 cursor-col-resize touch-none [@media(pointer:coarse)]:w-6"
          style={{ left: `${b * 100}%` }}
          onPointerDown={(e) => dragCol(e, i)}
          onDoubleClick={() => commit(T.fitCols)}>
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
        </div>
      ))}
      {editing && (
        <div className="absolute -bottom-12 left-0 flex gap-1" data-format-bar>
          <TBtn label="Zeile hinzufügen" disabled={cells.length >= T.MAX_ROWS} onClick={() => commit((d) => T.insertRow(d, d.cells.length))}><Plus className="size-4" />Zeile</TBtn>
          <TBtn label="Letzte Zeile entfernen" disabled={cells.length <= 1} onClick={() => commit((d) => T.deleteRow(d, d.cells.length - 1))}><Minus className="size-4" />Zeile</TBtn>
          <TBtn label="Spalte hinzufügen" disabled={cols >= T.MAX_COLS} onClick={() => commit((d) => T.insertCol(d, T.colCount(d)))}><Plus className="size-4" />Spalte</TBtn>
          <TBtn label="Letzte Spalte entfernen" disabled={cols <= 1} onClick={() => commit((d) => T.deleteCol(d, T.colCount(d) - 1))}><Minus className="size-4" />Spalte</TBtn>
        </div>
      )}
    </Frame>
  );
}

function TBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()} onClick={onClick}
      className="flex h-11 items-center gap-1 rounded-md border bg-card px-3 text-sm shadow-sm disabled:opacity-40">
      {children}
    </button>
  );
}

function Cell({ html, editable, header, bg, dark, onCommit, label, onTab, onMenu, onMoveRow }: {
  html: string; editable: boolean; header: boolean; bg: string | null; dark: boolean; onCommit: (h: string) => void; label: string;
  onTab: (back: boolean) => void; onMenu: (e: React.MouseEvent) => void; onMoveRow: (dir: -1 | 1) => void;
}) {
  const ref = useRef<HTMLTableCellElement>(null);
  useHtml(ref, html);
  return (
    <td
      ref={ref}
      aria-label={label}
      contentEditable={editable}
      suppressContentEditableWarning
      lang="de"
      className={cn("nf-rich h-11 border border-foreground/40 px-2 py-1 align-top break-words outline-none focus:bg-primary/5", header && "font-semibold", header && !bg && "bg-foreground/5")}
      style={bg ? { background: `color-mix(in oklab, ${bg} ${dark ? 35 : 80}%, transparent)` } : undefined}
      onPaste={pastePlain}
      onFocus={(e) => unlinkify(e.currentTarget)}
      onContextMenu={onMenu}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (richKeys(e)) return;
        if (e.key === "Tab") { e.preventDefault(); onCommit(sanitizeHtml(e.currentTarget.innerHTML)); onTab(e.shiftKey); }
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onCommit(sanitizeHtml(e.currentTarget.innerHTML));
          onMoveRow(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      onBlur={(e) => {
        const h = sanitizeHtml(e.currentTarget.innerHTML);
        onCommit(h);
        e.currentTarget.innerHTML = linkifyHtml(h);
      }}
    />
  );
}
