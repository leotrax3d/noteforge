import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { GripVertical, Minus, MoveHorizontal, Plus, Trash2 } from "lucide-react";
import type { CanvasEngine } from "@/canvas/core/engine";
import { makeObj, type CanvasObj, type TableObj, type TextObj } from "@/canvas/core/objects";
import { cn } from "@/lib/utils";
import { isBlankHtml, sanitizeHtml } from "./sanitize";

export interface ObjectLayerProps {
  objects: CanvasObj[];
  engine: CanvasEngine | null;
  /** Textwerkzeug aktiv → Objekte sind bedienbar. */
  interactive: boolean;
  editingId: string | null;
  onEditing: (id: string | null) => void;
  layerRef: (el: HTMLDivElement | null) => void;
  dark: boolean;
}

/** DOM-Ebene für Textcontainer und Tabellen; Kamera-Transform setzt die Engine direkt. */
export function ObjectLayer(p: ObjectLayerProps) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={p.layerRef} data-testid="object-layer" className="absolute top-0 left-0 origin-top-left" style={{ width: 0, height: 0 }}>
        {p.objects.map((o) =>
          o.kind === "text" ? (
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
function Frame({ obj, engine, interactive, editingId, onEditing, children, label }: BoxProps<CanvasObj> & { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = editingId === obj.id;
  const live = interactive || active;

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

  return (
    <div
      ref={ref}
      data-obj={obj.kind}
      data-id={obj.id}
      aria-label={label}
      className={cn(
        "absolute rounded-sm",
        live ? "pointer-events-auto" : "pointer-events-none",
        active ? "outline-2 outline-[var(--subject,#3b82f6)] outline-dashed" : interactive && "outline-1 outline-border outline-dashed",
      )}
      style={{ left: obj.x, top: obj.y, width: obj.w, transform: obj.angle ? `rotate(${obj.angle}rad)` : undefined }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!active) onEditing(obj.id);
      }}
    >
      {children}
      {live && (
        <div className="absolute -top-12 left-0 flex gap-1" style={{ transformOrigin: "0 100%" }}>
          <button type="button" aria-label={`${label} verschieben`} title="Verschieben" onPointerDown={(e) => drag(e, "move")}
            className="flex size-11 cursor-grab touch-none items-center justify-center rounded-md border bg-card shadow-sm">
            <GripVertical className="size-5" />
          </button>
          <button type="button" aria-label={`${label} löschen`} title="Löschen"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { onEditing(null); engine?.removeObject(obj.id); }}
            className="flex size-11 items-center justify-center rounded-md border bg-card text-destructive shadow-sm">
            <Trash2 className="size-5" />
          </button>
        </div>
      )}
      {live && (
        <button type="button" aria-label={`Breite von ${label} ändern`} title="Breite ändern" onPointerDown={(e) => drag(e, "width")}
          className="absolute top-1/2 -right-6 flex size-11 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border bg-card shadow-sm">
          <MoveHorizontal className="size-4" />
        </button>
      )}
    </div>
  );
}

/** innerHTML nur setzen, wenn das Element nicht gerade bearbeitet wird. */
function useHtml(ref: React.RefObject<HTMLElement | null>, html: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const clean = sanitizeHtml(html);
    if (el.innerHTML !== clean) el.innerHTML = clean;
  }, [ref, html]);
}

/** Einfügen nur als reiner Text (Bilder übernimmt der Canvas). */
function pastePlain(e: React.ClipboardEvent) {
  if ([...e.clipboardData.items].some((i) => i.type.startsWith("image/"))) return;
  e.preventDefault();
  e.stopPropagation();
  document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
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
  }, [active]);

  const pushLive = () => {
    clearTimeout(timer.current);
    const cur = engine?.store.getObj(obj.id);
    if (!engine || !cur || cur.kind !== "text" || !ed.current) return;
    const html = sanitizeHtml(ed.current.innerHTML);
    if (html !== cur.data.html) engine.updateObjectLive({ ...cur, data: { html } });
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
        className="nf-rich min-h-11 px-2 py-1.5 text-base leading-snug text-foreground outline-none"
        onFocus={() => {
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
                <Cell key={c} html={html} editable={live} header={r === 0} onCommit={(h) => setCell(r, c, h)} label={`Zelle ${r + 1}, ${c + 1}`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {live && (
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

function Cell({ html, editable, header, onCommit, label }: {
  html: string; editable: boolean; header: boolean; onCommit: (h: string) => void; label: string;
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
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(sanitizeHtml(e.currentTarget.innerHTML))}
    />
  );
}
