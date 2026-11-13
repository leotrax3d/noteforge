import { useState } from "react";
import { BookmarkPlus, Check, Copy, LineChart, Lock, MoveRight, Palette, PencilRuler, ScanText, Sigma, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SelectionInfo } from "@/canvas/core/engine";
import { ColorGrid, HeadPicker } from "./Toolbar";
import type { Head } from "@/canvas/vector/vec";
import { TagMenu } from "@/features/tags/TagMenu";
import { MoleculeIcon } from "@/features/chem/MoleculeIcon";
import { VIEW_LABELS, type MolView } from "@/features/chem/mol";

export function SelectionMenu({ sel, hostHeight, onColor, onCopy, onDelete, onDone, activeTags, onTag, onInkToText, onInkToLatex, onOcr, onEditPlot, onHeads, onEditVec, onSaveTemplate, onEditMol, onMolView, onLock }: {
  onLock: () => void;
  onEditMol: () => void;
  onMolView: (v: MolView) => void;
  onHeads: (h: Partial<{ head0: Head; head1: Head }>) => void;
  onEditVec: () => void;
  onSaveTemplate: () => void;
  onEditPlot?: () => void;
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
  const [headsOpen, setHeadsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  // Platz für den Drehgriff (36 px über der Auswahl) lassen
  const above = sel.rect.y > 180;
  const top = above ? sel.rect.y - 112 : Math.min(hostHeight - 64, sel.rect.y + sel.rect.h + 52);
  const left = sel.rect.x + sel.rect.w / 2;
  return (
    <div role="toolbar" aria-label="Auswahl" data-glass="" data-glass-float="" className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card p-1 shadow-lg"
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
      {sel.heads && (
        <Popover open={headsOpen} onOpenChange={setHeadsOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Pfeilspitzen" title="Pfeilspitzen ändern"><MoveRight /></Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <HeadPicker head0={sel.heads.head0} head1={sel.heads.head1} onChange={onHeads} />
          </PopoverContent>
        </Popover>
      )}
      {sel.vec && ["coord", "numberline", "staff", "bond"].includes(sel.vec.t) && (
        <Button variant="ghost" size="icon" aria-label="Form bearbeiten" title="Form bearbeiten (Achsen, Bereich …)" onClick={onEditVec}><PencilRuler /></Button>
      )}
      {sel.mol && (
        <>
          <Button variant="ghost" size="icon" aria-label="Strukturformel bearbeiten" title="Strukturformel bearbeiten (Doppeltipp)" onClick={onEditMol}><MoleculeIcon /></Button>
          <Popover open={viewOpen} onOpenChange={setViewOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" className="h-11" aria-label="Darstellung wechseln" title="Darstellung wechseln">Darstellung</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-1">
              {(Object.keys(VIEW_LABELS) as MolView[]).map((v) => (
                <Button key={v} variant={sel.mol?.view === v ? "secondary" : "ghost"} className="h-11 w-full justify-start"
                  aria-pressed={sel.mol?.view === v} onClick={() => { setViewOpen(false); onMolView(v); }}>{VIEW_LABELS[v]}</Button>
              ))}
            </PopoverContent>
          </Popover>
        </>
      )}
      <Button variant="ghost" size="icon" aria-label="Als Vorlage speichern" title="Als Vorlage speichern (Formen-Bibliothek → Eigene)" onClick={onSaveTemplate}><BookmarkPlus /></Button>
      {onEditPlot && <Button variant="ghost" size="icon" aria-label="Graph bearbeiten" title="Graph im Plotter bearbeiten" onClick={onEditPlot}><LineChart /></Button>}
      {sel.images > 0 && sel.strokes === 0 && (
        <Button variant="ghost" size="icon" aria-label="Sperren" title="Sperren: fest im Hintergrund, nicht mehr auswählbar (Schloss-Symbol zum Entsperren)" onClick={onLock}><Lock /></Button>
      )}
      <Button variant="ghost" size="icon" aria-label="Kopieren" title="Kopieren" onClick={onCopy}><Copy /></Button>
      <Button variant="ghost" size="icon" aria-label="Löschen" title="Löschen" onClick={onDelete}><Trash2 /></Button>
      <Button variant="ghost" size="icon" aria-label="Auswahl aufheben" title="Fertig" onClick={onDone}><Check /></Button>
    </div>
  );
}
