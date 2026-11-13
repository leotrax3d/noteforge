import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, GripHorizontal, MoveHorizontal, Minus, Plus, Trash2 } from "lucide-react";
import type { CanvasEngine } from "@/canvas/core/engine";
import { makeObj, type CanvasObj, type TableObj, type TextObj } from "@/canvas/core/objects";
import type { BBox, ElementTag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tagIcon, useTagStore } from "@/features/tags/tag-store";
import { isBlankHtml, linkifyHtml, sanitizeHtml } from "./sanitize";
import { MathView } from "@/features/recognition/Math";

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
            <MathBox key={o.id} obj={o} {...p} />
          ) : o.kind === "text" ? (
            <TextBox key={o.id} obj={o} {...p} />
          ) : o.kind === "table" ? (
            <TableBox key={o.id} obj={o} {...p} />
          ) : null,
        )}
      </div>
    </div>
  );
}

type BoxProps<T> = ObjectLayerProps & { obj: T };

/** Gemeinsamer Rahmen: Verschiebegriff, Breite ändern, Löschen. */
function Frame({ obj, engine, interactive, editingId, hoverId, onEditing, children, label }: BoxProps<CanvasObj> & { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = editingId === obj.id;
  const [held, setHeld] = useState(false);
  const hovered = hoverId === obj.id || held;
  const live = interactive || active || hovered;

  // Höhe an den Inhalt anpassen (ohne Verlauf)
  useEffect(() => {
    const el = ref.current;
    if (!el || !engine) return;
    const ro = new ResizeObserver(() => {
      const cur = engine.store.getObj(obj.id);
      if (!cur) return;
      const h = el.offsetHeight;
      if (Math.abs(h - cur.h) > 1) engine.updateObjectLive(makeObj({ ...cur, h }));
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
        : makeObj({ ...before, w: Math.max(80, before.w + dx) });
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
      style={{ left: obj.x, top: obj.y, width: obj.w, transform: obj.angle ? `rotate(${obj.angle}rad)` : undefined }}
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
        onPaste={pastePlain}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.currentTarget as HTMLElement).blur();
          if (e.key === " " && autoList()) { e.preventDefault(); e.stopPropagation(); return; }
          if (e.key === "Tab" && !e.shiftKey && engine) {
            // Tab macht aus dem Textfeld eine Tabelle (Zeilen → erste Spalte), weiter in Zelle 1/2
            e.preventDefault();
            const cur = engine.store.getObj(obj.id);
            if (cur?.kind !== "text") return;
            const lines = (ed.current?.innerText ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
            const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
            const cells = lines.length ? lines.map((l) => [esc(l), ""]) : [["", ""], ["", ""]];
            const table = makeObj<TableObj>({ id: cur.id + "-t", kind: "table", z: cur.z, x: cur.x, y: cur.y, w: Math.max(cur.w, 320), h: 44 * cells.length, angle: cur.angle, data: { cells } });
            before.current = null;
            engine.replaceObject(cur, table);
            onEditing(table.id);
            window.setTimeout(() => (document.querySelector(`[data-id="${table.id}"] td:nth-child(2)`) as HTMLElement | null)?.focus(), 50);
          }
          e.stopPropagation();
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
  const { obj, engine, interactive, editingId } = p;
  const live = interactive || editingId === obj.id;
  const editing = editingId === obj.id;
  const cells = obj.data.cells;
  const cols = cells[0]?.length ?? 1;

  const commit = (next: string[][]) => {
    const cur = engine?.store.getObj(obj.id);
    if (!engine || !cur || cur.kind !== "table") return;
    const after = makeObj({ ...cur, data: { cells: next } });
    engine.updateObjectLive(after);
    engine.recordObjectEdit(cur, after);
  };
  const setCell = (r: number, c: number, html: string) => {
    if (cells[r]?.[c] === html) return;
    commit(cells.map((row, i) => (i === r ? row.map((v, j) => (j === c ? html : v)) : row)));
  };

  return (
    <Frame {...p} label="Tabelle">
      <table className="w-full table-fixed border-collapse text-base text-foreground">
        <tbody>
          {cells.map((row, r) => (
            <tr key={r}>
              {row.map((html, c) => (
                <Cell key={c} html={html} editable={live} header={r === 0} onCommit={(h) => setCell(r, c, h)} label={`Zelle ${r + 1}, ${c + 1}`}
                  onTab={(back) => {
                    const all = [...document.querySelectorAll<HTMLElement>(`[data-id="${obj.id}"] td`)];
                    const i = r * cols + c + (back ? -1 : 1);
                    if (i < all.length && i >= 0) return all[i].focus();
                    if (back) return;
                    commit([...engine!.store.getObj(obj.id)!.kind === "table" ? (engine!.store.getObj(obj.id) as TableObj).data.cells : cells, Array(cols).fill("")]);
                    window.setTimeout(() => document.querySelectorAll<HTMLElement>(`[data-id="${obj.id}"] td`)[i]?.focus(), 30);
                  }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <div className="absolute -bottom-12 left-0 flex gap-1" data-format-bar>
          <TBtn label="Zeile hinzufügen" onClick={() => commit([...cells, Array(cols).fill("")])}><Plus className="size-4" />Zeile</TBtn>
          <TBtn label="Zeile entfernen" disabled={cells.length <= 1} onClick={() => commit(cells.slice(0, -1))}><Minus className="size-4" />Zeile</TBtn>
          <TBtn label="Spalte hinzufügen" onClick={() => commit(cells.map((row) => [...row, ""]))}><Plus className="size-4" />Spalte</TBtn>
          <TBtn label="Spalte entfernen" disabled={cols <= 1} onClick={() => commit(cells.map((row) => row.slice(0, -1)))}><Minus className="size-4" />Spalte</TBtn>
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

function Cell({ html, editable, header, onCommit, label, onTab }: {
  html: string; editable: boolean; header: boolean; onCommit: (h: string) => void; label: string; onTab: (back: boolean) => void;
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
      className={cn("h-11 border border-foreground/40 px-2 py-1 align-top outline-none focus:bg-primary/5", header && "font-semibold bg-foreground/5")}
      onPaste={pastePlain}
      onFocus={(e) => unlinkify(e.currentTarget)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Tab") { e.preventDefault(); onCommit(sanitizeHtml(e.currentTarget.innerHTML)); onTab(e.shiftKey); }
      }}
      onBlur={(e) => {
        const h = sanitizeHtml(e.currentTarget.innerHTML);
        onCommit(h);
        e.currentTarget.innerHTML = linkifyHtml(h);
      }}
    />
  );
}
