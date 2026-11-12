import { useMemo, useRef, useState, type ReactNode } from "react";
import { Bold, Check, Heading1, Heading2, Italic, Link2, List, ListOrdered, Pilcrow, Table, Underline } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PageRef } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS = ["#111827", "#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ca8a04"];

function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value);
}

function Btn({ label, onRun, children, className }: { label: string; onRun: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Fokus/Auswahl im Textfeld behalten
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent", className)}
    >
      {children}
    </button>
  );
}

/** Formatleiste für Rich Text (unten mittig, solange ein Textfeld bearbeitet wird). */
export function FormatBar({ onDone }: { onDone: () => void }) {
  return (
    <div data-format-bar role="toolbar" aria-label="Textformat"
      className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-2xl border bg-card/95 p-1.5 shadow-xl backdrop-blur">
      <Btn label="Fett" onRun={() => exec("bold")}><Bold /></Btn>
      <Btn label="Kursiv" onRun={() => exec("italic")}><Italic /></Btn>
      <Btn label="Unterstrichen" onRun={() => exec("underline")}><Underline /></Btn>
      <div className="mx-1 h-8 w-px bg-border" />
      <Btn label="Überschrift 1" onRun={() => exec("formatBlock", "<h1>")}><Heading1 /></Btn>
      <Btn label="Überschrift 2" onRun={() => exec("formatBlock", "<h2>")}><Heading2 /></Btn>
      <Btn label="Normaler Text" onRun={() => exec("formatBlock", "<p>")}><Pilcrow /></Btn>
      <Btn label="Aufzählung" onRun={() => exec("insertUnorderedList")}><List /></Btn>
      <Btn label="Nummerierte Liste" onRun={() => exec("insertOrderedList")}><ListOrdered /></Btn>
      <Btn label="Tabelle im Text einfügen" onRun={() =>
        exec("insertHTML", "<table><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>")}>
        <Table />
      </Btn>
      <LinkPicker />
      <div className="mx-1 h-8 w-px bg-border" />
      {COLORS.map((c) => (
        <Btn key={c} label={`Textfarbe ${c}`} onRun={() => exec("foreColor", c)}>
          <span className="size-6 rounded-full border border-black/10" style={{ background: c }} />
        </Btn>
      ))}
      <div className="mx-1 h-8 w-px bg-border" />
      <Btn label="Fertig" onRun={onDone} className="text-primary"><Check /></Btn>
    </div>
  );
}

/** Seitenlink einfügen: Blatt wählen (oder neuen Titel eingeben) → `[[Titel]]` an der Schreibmarke. */
function LinkPicker() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [refs, setRefs] = useState<PageRef[]>([]);
  const range = useRef<{ r: Range; el: HTMLElement } | null>(null);

  const remember = () => {
    const sel = window.getSelection();
    const el = document.activeElement as HTMLElement | null;
    if (sel?.rangeCount && el?.isContentEditable) range.current = { r: sel.getRangeAt(0).cloneRange(), el };
  };
  const insert = (title: string) => {
    const t = title.trim();
    setOpen(false);
    const saved = range.current;
    if (!t || !saved) return;
    saved.el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(saved.r);
    document.execCommand("insertText", false, `[[${t}]]`);
  };
  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return refs.filter((r) => r.title && (!f || r.title.toLowerCase().includes(f))).slice(0, 8);
  }, [refs, q]);

  return (
    <Popover open={open} onOpenChange={(o) => {
      setOpen(o);
      if (o) {
        setQ("");
        api.listPageRefs().then(setRefs, console.error);
      }
    }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Seitenlink einfügen" title="Seitenlink [[…]] einfügen"
          onPointerDown={(e) => { e.preventDefault(); remember(); }} onMouseDown={(e) => e.preventDefault()}
          className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent">
          <Link2 />
        </button>
      </PopoverTrigger>
      <PopoverContent data-format-bar className="w-72 p-2" side="top">
        <form onSubmit={(e) => { e.preventDefault(); insert(list[0]?.title ?? q); }}>
          <Input autoFocus aria-label="Blatt suchen" placeholder="Blatttitel …" value={q} onChange={(e) => setQ(e.target.value)} className="h-11" />
        </form>
        <ul role="listbox" aria-label="Blätter" className="mt-1 max-h-72 overflow-y-auto">
          {list.map((r) => (
            <li key={r.pageId}>
              <button type="button" role="option" aria-selected={false} onClick={() => insert(r.title)}
                className="flex min-h-11 w-full flex-col justify-center rounded-md px-2 text-left text-sm hover:bg-accent">
                <span>{r.title}</span><span className="text-xs text-muted-foreground">{r.subjectName}</span>
              </button>
            </li>
          ))}
          {q.trim() && !list.some((r) => r.title.toLowerCase() === q.trim().toLowerCase()) && (
            <li>
              <button type="button" onClick={() => insert(q)} className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-accent">
                Neues Blatt „{q.trim()}“ verlinken
              </button>
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
