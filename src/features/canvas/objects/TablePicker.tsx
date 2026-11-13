import { useState } from "react";
import { Minus, Plus, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_COLS, MAX_ROWS } from "./table-ops";

const GRID_C = 8, GRID_R = 6;

/** Tabellengröße wählen wie in LibreOffice/Word: Raster überfahren/antippen oder Zeilen/Spalten genau eingeben. */
export function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const shown = hover ?? { r: rows, c: cols };
  return (
    <div className="space-y-2" data-testid="table-picker">
      <p className="text-sm font-medium">Tabelle: {shown.r} × {shown.c}</p>
      <div role="grid" aria-label="Tabellengröße wählen" className="grid w-max gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_C}, 2.75rem)` }}
        onPointerLeave={() => setHover(null)}>
        {Array.from({ length: GRID_R * GRID_C }, (_, i) => {
          const r = Math.floor(i / GRID_C) + 1, c = (i % GRID_C) + 1;
          const on = r <= shown.r && c <= shown.c;
          return (
            <button key={i} type="button" aria-label={`${r} Zeilen, ${c} Spalten`}
              onPointerEnter={(e) => e.pointerType !== "touch" && setHover({ r, c })}
              onClick={() => onPick(r, c)}
              className="flex size-11 items-center justify-center">
              <span className={cn("size-7 rounded-sm border", on ? "border-primary bg-primary/25" : "bg-muted/40")} />
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Stepper label="Zeilen" value={rows} max={MAX_ROWS} onChange={setRows} />
        <Stepper label="Spalten" value={cols} max={MAX_COLS} onChange={setCols} />
      </div>
      <Button className="h-11 w-full" onClick={() => onPick(rows, cols)}><Table /> {rows} × {cols} einfügen</Button>
    </div>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(1, Math.round(v) || 1)));
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Button variant="outline" size="icon" className="size-11" aria-label={`${label} weniger`} onClick={() => set(value - 1)}><Minus /></Button>
      <input type="number" min={1} max={max} value={value} aria-label={label} onChange={(e) => set(Number(e.target.value))}
        className="h-11 w-14 rounded-md border bg-background text-center text-sm" />
      <Button variant="outline" size="icon" className="size-11" aria-label={`${label} mehr`} onClick={() => set(value + 1)}><Plus /></Button>
    </div>
  );
}
