import { useState } from "react";
import { Check, Copy, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface OcrView { text: string; error?: string }

/** Erkannter Text in einzeln kopierbare Abschnitte (Zeilen) zerlegen. */
export function ocrLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Markierter Text innerhalb des Dialogs (sonst leer). */
function selectedIn(root: HTMLElement | null): string {
  const s = window.getSelection();
  if (!root || !s || s.isCollapsed || !s.anchorNode || !root.contains(s.anchorNode)) return "";
  return s.toString().trim();
}

/** Ergebnis der Bild-Texterkennung: alles, eine Zeile oder eine Markierung kopieren – oder als Textfeld einfügen. */
export function OcrDialog({ view, onOpenChange, onInsert }: {
  view: OcrView | null;
  onOpenChange: (open: boolean) => void;
  onInsert: (text: string) => void;
}) {
  const empty = !view?.text.trim();
  const lines = view ? ocrLines(view.text) : [];
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const copy = (text: string, key: number | "all") => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };
  return (
    <Dialog open={!!view} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Text im Bild</DialogTitle>
          <DialogDescription className={empty || view?.error ? undefined : "sr-only"}>
            {view?.error ?? (empty ? "Im Bild wurde kein Text gefunden." : "Erkannter Text – Zeile kopieren oder Text markieren.")}
          </DialogDescription>
        </DialogHeader>
        {!empty && (
          <ul ref={setRoot} data-testid="ocr-text" className="max-h-96 select-text divide-y overflow-auto rounded-md border bg-background">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-1 pl-3">
                <span className="min-w-0 flex-1 cursor-text py-2 text-base break-words whitespace-pre-wrap select-text">{l}</span>
                <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Zeile ${i + 1} kopieren`} title="Diese Zeile kopieren"
                  onClick={() => copy(l, i)}>
                  {copied === i ? <Check className="text-primary" /> : <Copy />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="gap-2">
          {!empty && (
            <>
              <Button variant="outline" className="h-11" title="Markierten Text kopieren, sonst alles"
                onMouseDown={(e) => e.preventDefault() /* Markierung behalten */}
                onClick={() => { const s = selectedIn(root); copy(s || view!.text, "all"); }}>
                {copied === "all" ? <Check /> : <Copy />} Markierung / alles kopieren
              </Button>
              <Button variant="outline" className="h-11" onMouseDown={(e) => e.preventDefault()} onClick={() => { onInsert(selectedIn(root) || view!.text); onOpenChange(false); }}><TextCursorInput /> Als Textfeld einfügen</Button>
            </>
          )}
          <Button className="h-11" onClick={() => onOpenChange(false)}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
