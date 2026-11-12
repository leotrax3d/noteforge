import type { ReactNode } from "react";
import { Bold, Check, Heading1, Heading2, Italic, List, ListOrdered, Pilcrow, Table, Underline } from "lucide-react";
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
