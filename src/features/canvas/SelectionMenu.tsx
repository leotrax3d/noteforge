import { useState } from "react";
import { Check, Copy, Palette, ScanText, Sigma, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SelectionInfo } from "@/canvas/core/engine";
import { ColorGrid } from "./Toolbar";
import { TagMenu } from "@/features/tags/TagMenu";

export function SelectionMenu({ sel, hostHeight, onColor, onCopy, onDelete, onDone, activeTags, onTag, onInkToText, onInkToLatex, onOcr }: {
  onInkToText: () => void;
  onInkToLatex: () => void;
  onOcr: () => void;
  activeTags: Set<string>;
  onTag: (tagId: string, on: boolean) => void;
  sel: SelectionInfo;
  hostHeight: number;
  onColor: (c: string) => void;
  onCopy: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const above = sel.rect.y > 140;
  const top = above ? sel.rect.y - 64 : Math.min(hostHeight - 64, sel.rect.y + sel.rect.h + 52);
  const left = sel.rect.x + sel.rect.w / 2;
  return (
    <div role="toolbar" aria-label="Auswahl" className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card p-1 shadow-lg"
      style={{ top: Math.max(8, top), left }}>
      <span className="px-2 text-sm text-muted-foreground tabular-nums">{sel.count} {sel.count === 1 ? "Element" : "Elemente"}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Farbe ändern" title="Farbe ändern"><Palette /></Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <ColorGrid value={sel.color} onPick={(c) => { onColor(c); setOpen(false); }} />
        </PopoverContent>
      </Popover>
      <TagMenu active={activeTags} onToggle={onTag} />
      {sel.strokes > 0 && (
        <>
          <Button variant="ghost" size="icon" aria-label="In Text umwandeln" title="Handschrift → Text" onClick={onInkToText}><Type /></Button>
          <Button variant="ghost" size="icon" aria-label="Als Formel (LaTeX)" title="Formel → LaTeX" onClick={onInkToLatex}><Sigma /></Button>
        </>
      )}
      {sel.images > 0 && sel.strokes === 0 && (
        <Button variant="ghost" size="icon" aria-label="Text im Bild erkennen" title="Text im Bild erkennen (OCR)" onClick={onOcr}><ScanText /></Button>
      )}
      <Button variant="ghost" size="icon" aria-label="Kopieren" title="Kopieren" onClick={onCopy}><Copy /></Button>
      <Button variant="ghost" size="icon" aria-label="Löschen" title="Löschen" onClick={onDelete}><Trash2 /></Button>
      <Button variant="ghost" size="icon" aria-label="Auswahl aufheben" title="Fertig" onClick={onDone}><Check /></Button>
    </div>
  );
}
