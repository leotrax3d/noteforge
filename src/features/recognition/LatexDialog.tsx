import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MathView, latexError } from "./Math";

export interface LatexRequest {
  /** Vorschlag aus der Erkennung (leer, wenn nichts erkannt). */
  latex: string;
  /** Hinweis, z. B. „Erkennung nur in der Windows-App“. */
  note?: string;
  /** Bestehende Formel bearbeiten (statt Handschrift ersetzen). */
  edit?: boolean;
}

const SNIPPETS: [string, string][] = [
  ["\\frac{a}{b}", "\\frac{}{}"], ["x^{2}", "^{}"], ["x_{n}", "_{}"], ["\\sqrt{x}", "\\sqrt{}"],
  ["\\cdot", "\\cdot "], ["\\pi", "\\pi "], ["\\le", "\\le "], ["\\ne", "\\neq "],
];

export function LatexDialog({ req, onOpenChange, onInsert }: {
  req: LatexRequest | null;
  onOpenChange: (open: boolean) => void;
  onInsert: (latex: string, keepInk: boolean) => void;
}) {
  const [src, setSrc] = useState("");
  const [keep, setKeep] = useState(false);
  useEffect(() => {
    if (req) { setSrc(req.latex); setKeep(false); }
  }, [req]);
  const err = src.trim() ? latexError(src) : "Formel ist leer";

  return (
    <Dialog open={!!req} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!err) { onInsert(src.trim(), keep); onOpenChange(false); } }}>
          <DialogHeader>
            <DialogTitle>{req?.edit ? "Formel bearbeiten" : "Formel (LaTeX)"}</DialogTitle>
            <DialogDescription>{req?.note ?? "Erkannte Formel prüfen und bei Bedarf korrigieren."}</DialogDescription>
          </DialogHeader>
          <div aria-label="Vorschau" data-testid="latex-preview"
            className="flex min-h-24 items-center justify-center overflow-x-auto rounded-md border bg-background p-3 text-xl">
            <MathView latex={src} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="latex-src">LaTeX</Label>
            <textarea id="latex-src" rows={3} autoFocus value={src} spellCheck={false} onChange={(e) => setSrc(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
            <div className="flex flex-wrap gap-1" aria-label="Bausteine">
              {SNIPPETS.map(([show, ins]) => (
                <Button key={show} type="button" variant="outline" className="min-w-11 font-mono" title={show}
                  onClick={() => setSrc((s) => s + ins)}>
                  <MathView latex={show} display={false} className="pointer-events-none" />
                </Button>
              ))}
            </div>
          </div>
          {!req?.edit && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Handschrift behalten
            </label>
          )}
          {err && src.trim() && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={!!err}>{req?.edit ? "Übernehmen" : "Einfügen"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
