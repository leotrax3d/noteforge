import { Copy, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface OcrView { text: string; error?: string }

/** Ergebnis der Bild-Texterkennung: kopieren oder als Textfeld einfügen. */
export function OcrDialog({ view, onOpenChange, onInsert }: {
  view: OcrView | null;
  onOpenChange: (open: boolean) => void;
  onInsert: (text: string) => void;
}) {
  const empty = !view?.text.trim();
  return (
    <Dialog open={!!view} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Text im Bild</DialogTitle>
          <DialogDescription>
            {view?.error ?? (empty ? "Im Bild wurde kein Text gefunden." : "Erkannter Text (Windows-OCR, offline). Er ist auch über die Suche auffindbar.")}
          </DialogDescription>
        </DialogHeader>
        {!empty && (
          <pre data-testid="ocr-text" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 font-sans text-base">{view?.text}</pre>
        )}
        <DialogFooter className="gap-2">
          {!empty && (
            <>
              <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(view!.text)}><Copy /> Kopieren</Button>
              <Button variant="outline" onClick={() => { onInsert(view!.text); onOpenChange(false); }}><TextCursorInput /> Als Textfeld einfügen</Button>
            </>
          )}
          <Button onClick={() => onOpenChange(false)}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
