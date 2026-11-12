// Formen-Bibliothek (SPEC §4.3): fachbezogene Vorlagen als bearbeitbare Vektor-Elemente + eigene Vorlagen.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { MoleculeIcon } from "@/features/chem/MoleculeIcon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  LAB_LABELS, SYMBOL_LABELS, defaultCoord, defaultNumberLine, defaultStaff, renderVec, svgUrl,
  type BondSpec, type CoordSpec, type LabName, type NumberLineSpec, type StaffSpec, type SymbolName, type VecSpec,
} from "@/canvas/vector/vec";
import { MM } from "@/canvas/core/layout";
import { shapesApi, type ShapeTemplate } from "./shapes-api";

type Cat = "math" | "physics" | "chemistry" | "music" | "own";
const CATS: { id: Cat; label: string }[] = [
  { id: "math", label: "Mathe" }, { id: "physics", label: "Physik" }, { id: "chemistry", label: "Chemie" },
  { id: "music", label: "Musik" }, { id: "own", label: "Eigene" },
];

export interface ShapeLibraryProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Raster des Blatts (Welt), für Einheiten von Achsen/Zahlenstrahl */
  grid: number;
  color: string;
  /** Bearbeiten eines vorhandenen Elements (aus dem Auswahlmenü) */
  edit: VecSpec | null;
  onInsert: (spec: VecSpec) => void;
  onUpdate: (spec: VecSpec) => void;
  onInsertTemplate: (t: ShapeTemplate) => void;
}

function Preview({ spec }: { spec: VecSpec }) {
  const src = useMemo(() => svgUrl(renderVec(spec).svg), [spec]);
  return <img src={src} alt="" className="max-h-full max-w-full object-contain dark:invert dark:hue-rotate-180" draggable={false} />;
}

function Tile({ label, spec, onClick }: { label: string; spec: VecSpec; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${label} einfügen`} aria-label={`${label} einfügen`}
      className="flex min-h-24 flex-col items-center justify-between gap-1 rounded-lg border p-2 text-xs hover:bg-accent">
      <span className="flex h-14 w-full items-center justify-center"><Preview spec={spec} /></span>
      {label}
    </button>
  );
}

function Num({ id, label, value, onChange, step = 1 }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Input id={id} type="number" step={step} value={value} className="h-11" onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
    </div>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-11 items-center gap-2 text-sm">
      <input type="checkbox" className="size-5" checked={on} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/** Einstellbare Vorlagen (Koordinatensystem, Zahlenstrahl, Notenlinien, Bindung). */
function Editor({ spec, onChange, grid }: { spec: VecSpec; onChange: (s: VecSpec) => void; grid: number }) {
  switch (spec.t) {
    case "coord": {
      const s = spec as CoordSpec, set = (p: Partial<CoordSpec>) => onChange({ ...s, ...p });
      return (
        <div className="grid grid-cols-4 gap-2">
          <Num id="cx0" label="x von" value={s.xmin} onChange={(xmin) => set({ xmin: Math.min(xmin, s.xmax - s.step) })} />
          <Num id="cx1" label="x bis" value={s.xmax} onChange={(xmax) => set({ xmax: Math.max(xmax, s.xmin + s.step) })} />
          <Num id="cy0" label="y von" value={s.ymin} onChange={(ymin) => set({ ymin: Math.min(ymin, s.ymax - s.step) })} />
          <Num id="cy1" label="y bis" value={s.ymax} onChange={(ymax) => set({ ymax: Math.max(ymax, s.ymin + s.step) })} />
          <Num id="cst" label="Skalierung (Schritt)" step={0.5} value={s.step} onChange={(step) => step > 0 && set({ step })} />
          <Num id="cun" label="Kästchen je Einheit" value={Math.round(s.unit / grid)} onChange={(k) => k >= 1 && set({ unit: k * grid })} />
          <div className="space-y-1"><Label htmlFor="cxl" className="text-xs text-muted-foreground">x-Achse</Label>
            <Input id="cxl" className="h-11" value={s.xLabel} onChange={(e) => set({ xLabel: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="cyl" className="text-xs text-muted-foreground">y-Achse</Label>
            <Input id="cyl" className="h-11" value={s.yLabel} onChange={(e) => set({ yLabel: e.target.value })} /></div>
          <Check label="Raster" on={s.grid} onChange={(grid) => set({ grid })} />
          <Check label="Beschriftung" on={s.labels} onChange={(labels) => set({ labels })} />
        </div>
      );
    }
    case "numberline": {
      const s = spec as NumberLineSpec, set = (p: Partial<NumberLineSpec>) => onChange({ ...s, ...p });
      return (
        <div className="grid grid-cols-4 gap-2">
          <Num id="nmin" label="von" value={s.min} onChange={(min) => set({ min: Math.min(min, s.max - s.step) })} />
          <Num id="nmax" label="bis" value={s.max} onChange={(max) => set({ max: Math.max(max, s.min + s.step) })} />
          <Num id="nst" label="Schritt" step={0.5} value={s.step} onChange={(step) => step > 0 && set({ step })} />
          <Num id="nun" label="Kästchen je Schritt" value={Math.round((s.unit * s.step) / grid)} onChange={(k) => k >= 1 && set({ unit: (k * grid) / s.step })} />
          <Check label="Beschriftung" on={s.labels} onChange={(labels) => set({ labels })} />
        </div>
      );
    }
    case "staff": {
      const s = spec as StaffSpec, set = (p: Partial<StaffSpec>) => onChange({ ...s, ...p });
      return (
        <div className="grid grid-cols-3 gap-2">
          <Num id="sl" label="Länge (cm)" value={Math.round(s.length / MM / 10)} onChange={(cm) => cm > 1 && set({ length: cm * 10 * MM })} />
          <Num id="sg" label="Linienabstand (mm)" step={0.5} value={s.gap / MM} onChange={(mm) => mm > 0.5 && set({ gap: mm * MM })} />
          <Check label="Violinschlüssel" on={s.clef} onChange={(clef) => set({ clef })} />
        </div>
      );
    }
    case "bond": {
      const s = spec as BondSpec;
      return (
        <div className="flex gap-1">
          {([1, 2, 3] as const).map((o) => (
            <Button key={o} variant={s.order === o ? "secondary" : "outline"} className={cn("h-11", s.order === o && "ring-2 ring-ring")}
              onClick={() => onChange({ ...s, order: o })}>{["Einfach", "Doppel", "Dreifach"][o - 1]}</Button>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

export function ShapeLibrary(p: ShapeLibraryProps) {
  const [cat, setCat] = useState<Cat>("math");
  const [draft, setDraft] = useState<VecSpec | null>(null);
  const [own, setOwn] = useState<ShapeTemplate[]>([]);
  const c = p.color;

  useEffect(() => {
    if (!p.open) return;
    setDraft(p.edit);
    void shapesApi.list().then(setOwn).catch(() => setOwn([]));
  }, [p.open, p.edit]);

  const insert = (s: VecSpec) => { p.onInsert(s); p.onOpenChange(false); };
  const configurable = (s: VecSpec) => setDraft(s);

  const tiles: Record<Exclude<Cat, "own">, { label: string; spec: VecSpec; configure?: boolean }[]> = {
    math: [
      { label: "Koordinatensystem", spec: defaultCoord(p.grid, c), configure: true },
      { label: "Nur 1. Quadrant", spec: { ...defaultCoord(p.grid, c), xmin: 0, ymin: 0, xmax: 8, ymax: 6 }, configure: true },
      { label: "Zahlenstrahl", spec: defaultNumberLine(p.grid, c), configure: true },
    ],
    physics: (Object.keys(SYMBOL_LABELS) as SymbolName[]).map((name) => ({ label: SYMBOL_LABELS[name], spec: { t: "symbol", name, color: c } })),
    chemistry: [
      ...(Object.keys(LAB_LABELS) as LabName[]).map((name) => ({ label: LAB_LABELS[name], spec: { t: "lab", name, color: c } as VecSpec })),
      ...([1, 2, 3] as const).map((order) => ({ label: ["Einfachbindung", "Doppelbindung", "Dreifachbindung"][order - 1], spec: { t: "bond", order, length: 10 * MM, color: c } as VecSpec })),
    ],
    music: [
      { label: "Notenlinien", spec: defaultStaff(c), configure: true },
      { label: "Ohne Schlüssel", spec: { ...defaultStaff(c), clef: false }, configure: true },
    ],
  };

  let body: ReactNode;
  if (draft) {
    body = (
      <div className="space-y-3">
        <div className="flex h-48 items-center justify-center rounded-lg border bg-white p-2 dark:bg-neutral-900"><Preview spec={draft} /></div>
        <Editor spec={draft} onChange={setDraft} grid={p.grid} />
        <div className="flex gap-2">
          <Button variant="outline" className="h-11" onClick={() => (p.edit ? p.onOpenChange(false) : setDraft(null))}>{p.edit ? "Abbrechen" : "Zurück"}</Button>
          <Button className="ml-auto h-11" onClick={() => { if (p.edit) p.onUpdate(draft); else p.onInsert(draft); p.onOpenChange(false); }}>
            {p.edit ? "Übernehmen" : "Einfügen"}
          </Button>
        </div>
      </div>
    );
  } else if (cat === "own") {
    body = own.length ? (
      <ul className="grid grid-cols-3 gap-2">
        {own.map((t) => (
          <li key={t.id} className="relative">
            <button type="button" className="flex h-24 w-full items-center justify-center rounded-lg border p-2 text-sm hover:bg-accent"
              onClick={() => { p.onInsertTemplate(t); p.onOpenChange(false); }}>{t.name}</button>
            <Button variant="ghost" size="icon" aria-label={`Vorlage ${t.name} löschen`} title="Löschen" className="absolute top-0 right-0"
              onClick={() => void shapesApi.remove(t.id).then(() => setOwn((o) => o.filter((x) => x.id !== t.id)))}><Trash2 /></Button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="py-8 text-center text-sm text-muted-foreground">Noch keine eigenen Formen. Wähle etwas mit dem Lasso aus und tippe im Auswahlmenü auf „Als Vorlage speichern“.</p>
    );
  } else {
    body = (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {cat === "chemistry" && (
          <button type="button" className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-sm hover:bg-accent"
            onClick={() => { p.onOpenChange(false); window.dispatchEvent(new CustomEvent("nf-molecule")); }}>
            <MoleculeIcon className="size-8" /> Strukturformel …
          </button>
        )}
        {tiles[cat].map((x) => <Tile key={x.label} label={x.label} spec={x.spec} onClick={() => (x.configure ? configurable(x.spec) : insert(x.spec))} />)}
      </div>
    );
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="shape-library">
        <DialogTitle>{p.edit ? "Form bearbeiten" : "Formen-Bibliothek"}</DialogTitle>
        <DialogDescription>Vorlagen werden als bearbeitbare Elemente eingefügt (verschieben, skalieren, Farbe; Achsen später änderbar). Leitungen rasten an den Anschlüssen der Schaltzeichen ein.</DialogDescription>
        {!draft && (
          <div role="tablist" aria-label="Kategorie" className="flex flex-wrap gap-1">
            {CATS.map((k) => (
              <Button key={k.id} role="tab" aria-selected={cat === k.id} variant={cat === k.id ? "secondary" : "ghost"}
                className={cn("h-11", cat === k.id && "ring-2 ring-ring")} onClick={() => setCat(k.id)}>{k.label}</Button>
            ))}
          </div>
        )}
        {body}
      </DialogContent>
    </Dialog>
  );
}
