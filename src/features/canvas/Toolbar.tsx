import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Calculator, LineChart,
  Crop, DraftingCompass, Eraser, GripVertical, Hand, Highlighter, ImagePlus, Lasso, Pen, PenTool, Pencil, Plus, Redo2, Ruler,
  Settings2, Shapes, Table, Trash2, TriangleRight, Type, Undo2, FileUp,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PenKind } from "@/canvas/core/model";
import { PENS } from "@/canvas/core/pens";
import type { Page, PagePatch } from "@/lib/types";
import { HIGHLIGHTS, MAX_PRESET_COUNT, PALETTE, useTools, type Dock } from "./tool-store";

export const PEN_ICONS: Record<PenKind, typeof Pen> = {
  fountain: PenTool,
  ballpoint: Pen,
  pencil: Pencil,
  highlighter: Highlighter,
};

export interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoomLabelRef: RefObject<HTMLSpanElement | null>;
  onZoom: (factor: number | "reset") => void;
  page: Page;
  onPageChange: (patch: PagePatch) => void;
  onInsert: (kind: InsertKind) => void;
}

export type InsertKind = "image" | "screenshot" | "table" | "text" | "pdf" | "plot" | "calc";

function ToolButton({ label, active, onClick, children, className }: {
  label: string; active?: boolean; onClick: () => void; children: ReactNode; className?: string;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("relative shrink-0", active && "ring-2 ring-[var(--subject,var(--ring))]", className)}
    >
      {children}
    </Button>
  );
}

function Toggle({ label, icon, on, onClick }: { label: string; icon: ReactNode; on: boolean; onClick: () => void }) {
  return (
    <Button variant={on ? "secondary" : "ghost"} role="switch" aria-checked={on} aria-label={label}
      className={cn("h-11 w-full justify-start", on && "ring-2 ring-ring")} onClick={onClick}>
      {icon} <span className="flex-1 text-left">{label}</span>
      <span className={cn("text-xs", on ? "text-primary" : "text-muted-foreground")}>{on ? "An" : "Aus"}</span>
    </Button>
  );
}

function Sep({ vertical }: { vertical: boolean }) {
  return <div className={cn("shrink-0 bg-border", vertical ? "my-1 h-px w-8" : "mx-1 h-8 w-px")} />;
}

function Chips<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Button key={String(o.value)} role="radio" aria-checked={value === o.value} variant={value === o.value ? "secondary" : "outline"}
          className={cn("h-11 min-w-11 px-3", value === o.value && "ring-2 ring-ring")} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function Swatch({ color, active, onClick, label }: { color: string; active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick}
      className={cn("flex size-11 items-center justify-center rounded-full border-2", active ? "border-ring" : "border-transparent")}>
      <span className="block size-7 rounded-full border border-black/10" style={{ background: color }} />
    </button>
  );
}

export function ColorGrid({ value, onPick, highlight }: { value: string | null; onPick: (c: string) => void; highlight?: boolean }) {
  const custom = useTools((s) => s.customColors);
  const addCustom = useTools((s) => s.addCustomColor);
  const colors = highlight ? HIGHLIGHTS : PALETTE;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-0.5">
        {colors.map((c) => <Swatch key={c} color={c} label={`Farbe ${c}`} active={value === c} onClick={() => onPick(c)} />)}
      </div>
      {custom.length > 0 && (
        <div className="grid grid-cols-6 gap-0.5">
          {custom.map((c) => <Swatch key={c} color={c} label={`Eigene Farbe ${c}`} active={value === c} onClick={() => onPick(c)} />)}
        </div>
      )}
      <label className="flex h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent">
        <input type="color" className="size-7 cursor-pointer border-0 bg-transparent p-0" value={value ?? "#000000"}
          onChange={(e) => onPick(e.target.value)} onBlur={(e) => addCustom(e.target.value)} aria-label="Eigene Farbe wählen" />
        Eigene Farbe …
      </label>
    </div>
  );
}

export function Toolbar(p: ToolbarProps) {
  const t = useTools();
  const [open, setOpen] = useState<null | "pen" | "eraser" | "page" | "guides" | "insert">(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const vertical = t.dock === "left" || t.dock === "right";

  const onPen = (pen: PenKind) => {
    if (t.tool === "pen" && t.pen === pen) setOpen(open === "pen" ? null : "pen");
    else t.setPen(pen);
  };
  const onEraser = () => {
    if (t.tool === "eraser") setOpen(open === "eraser" ? null : "eraser");
    else t.setTool("eraser");
  };

  // Ziehen am Griff: frei verschieben, beim Loslassen an nächste Kante andocken.
  const onGrip = (e: React.PointerEvent) => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const pr = parent.getBoundingClientRect();
    const move = (ev: PointerEvent) => setDrag({ x: ev.clientX - pr.left, y: ev.clientY - pr.top });
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      const x = (ev.clientX - pr.left) / pr.width, y = (ev.clientY - pr.top) / pr.height;
      const d: [Dock, number][] = [["top", y], ["bottom", 1 - y], ["left", x], ["right", 1 - x]];
      d.sort((a, b) => a[1] - b[1]);
      t.setDock(d[0][0]);
      setDrag(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const dockClass: Record<Dock, string> = {
    top: "top-3 left-1/2 -translate-x-1/2 flex-row w-max max-w-[calc(100%-24px)]",
    bottom: "bottom-3 left-1/2 -translate-x-1/2 flex-row w-max max-w-[calc(100%-24px)]",
    left: "left-3 top-1/2 -translate-y-1/2 flex-col max-h-[calc(100%-24px)]",
    right: "right-3 top-1/2 -translate-y-1/2 flex-col max-h-[calc(100%-24px)]",
  };
  const side = t.dock === "top" ? "bottom" : t.dock === "bottom" ? "top" : t.dock === "left" ? "right" : "left";
  const isHl = t.pen === "highlighter";

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Werkzeugleiste"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      data-dock={t.dock}
      className={cn(
        "absolute z-20 flex items-center gap-1 rounded-2xl border bg-card/95 p-1.5 shadow-xl backdrop-blur",
        vertical ? "overflow-y-auto" : "flex-wrap justify-center",
        drag ? "pointer-events-auto opacity-80" : dockClass[t.dock],
      )}
      style={drag ? { left: drag.x, top: drag.y, transform: "translate(-22px, -22px)", flexDirection: vertical ? "column" : "row" } : undefined}
    >
      <button type="button" aria-label="Werkzeugleiste verschieben" title="Ziehen zum Andocken"
        onPointerDown={onGrip}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing">
        <GripVertical className={cn("size-5", !vertical && "")} />
      </button>

      <Popover open={open === "pen"} onOpenChange={(o) => setOpen(o ? "pen" : null)}>
        <PopoverAnchor asChild>
          <div className={cn("flex gap-1", vertical ? "flex-col" : "flex-row")}>
            {(Object.keys(PENS) as PenKind[]).map((k) => {
              const Icon = PEN_ICONS[k];
              const active = t.tool === "pen" && t.pen === k;
              return (
                <ToolButton key={k} label={PENS[k].label} active={active} onClick={() => onPen(k)}>
                  <Icon />
                  <span className="absolute right-1.5 bottom-1.5 size-2.5 rounded-full border border-black/10"
                    style={{ background: t.perPen[k].color }} />
                </ToolButton>
              );
            })}
          </div>
        </PopoverAnchor>
        <PopoverContent side={side} className="w-80 space-y-3">
          <p className="text-sm font-medium">{PENS[t.pen].label}</p>
          <ColorGrid value={t.color} onPick={t.setColor} highlight={isHl} />
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Breite</p>
            <div role="radiogroup" aria-label="Strichbreite" className="flex gap-1">
              {PENS[t.pen].widths.map((w) => (
                <Button key={w} role="radio" aria-checked={t.width === w} aria-label={`Breite ${w}`}
                  variant={t.width === w ? "secondary" : "outline"} size="icon"
                  className={cn(t.width === w && "ring-2 ring-ring")} onClick={() => t.setWidth(w)}>
                  <span className="rounded-full" style={{ width: Math.min(26, w * (isHl ? 0.8 : 2.2) + 2), height: Math.min(26, w * (isHl ? 0.8 : 2.2) + 2), background: t.color }} />
                </Button>
              ))}
            </div>
          </div>
          <Button variant="outline" className="h-11 w-full" disabled={t.presets.length >= MAX_PRESET_COUNT}
            onClick={() => { t.addPreset(); setOpen(null); }}>
            <Plus /> Als Preset speichern
          </Button>
        </PopoverContent>
      </Popover>

      <Popover open={open === "eraser"} onOpenChange={(o) => setOpen(o ? "eraser" : null)}>
        <PopoverAnchor asChild>
          <div>
            <ToolButton label="Radierer" active={t.tool === "eraser"} onClick={onEraser}><Eraser /></ToolButton>
          </div>
        </PopoverAnchor>
        <PopoverContent side={side} className="space-y-3">
          <p className="text-sm font-medium">Radierer</p>
          <Chips label="Radiermodus" value={t.eraserMode} onChange={(m) => t.setEraser({ eraserMode: m })}
            options={[{ value: "stroke", label: "Ganze Striche" }, { value: "partial", label: "Teilweise" }]} />
          <Chips label="Radiergröße" value={t.eraserSize} onChange={(s) => t.setEraser({ eraserSize: s })}
            options={[{ value: 8, label: "S" }, { value: 14, label: "M" }, { value: 24, label: "L" }, { value: 40, label: "XL" }]} />
          <p className="text-xs text-muted-foreground">Tipp: Das Radierende des Stifts wird automatisch erkannt.</p>
        </PopoverContent>
      </Popover>

      <ToolButton label="Lasso" active={t.tool === "lasso"} onClick={() => t.setTool("lasso")}><Lasso /></ToolButton>
      <ToolButton label="Verschieben" active={t.tool === "pan"} onClick={() => t.setTool("pan")}><Hand /></ToolButton>
      <ToolButton label="Text" active={t.tool === "text"} onClick={() => t.setTool("text")}><Type /></ToolButton>

      <Popover open={open === "guides"} onOpenChange={(o) => setOpen(o ? "guides" : null)}>
        <PopoverAnchor asChild>
          <div>
            <ToolButton label="Hilfsmittel" active={open === "guides" || t.shapeMode || Object.values(t.guides).some(Boolean)}
              onClick={() => setOpen(open === "guides" ? null : "guides")}>
              <Ruler />
            </ToolButton>
          </div>
        </PopoverAnchor>
        <PopoverContent side={side} className="w-72 space-y-1">
          <p className="pb-1 text-sm font-medium">Hilfsmittel</p>
          <Toggle label="Lineal" icon={<Ruler />} on={t.guides.ruler} onClick={() => t.toggleGuide("ruler")} />
          <Toggle label="Geodreieck" icon={<TriangleRight />} on={t.guides.setsquare} onClick={() => t.toggleGuide("setsquare")} />
          <Toggle label="Zirkel" icon={<DraftingCompass />} on={t.guides.compass} onClick={() => t.toggleGuide("compass")} />
          <Toggle label="Formmodus (immer Formen)" icon={<Shapes />} on={t.shapeMode} onClick={() => t.setShapeMode(!t.shapeMode)} />
          <p className="pt-1 text-xs text-muted-foreground">
            Zwei Finger drehen und verschieben Lineal und Geodreieck. Stift am Strichende kurz halten → Form.
          </p>
        </PopoverContent>
      </Popover>

      <Popover open={open === "insert"} onOpenChange={(o) => setOpen(o ? "insert" : null)}>
        <PopoverAnchor asChild>
          <div>
            <ToolButton label="Einfügen" active={open === "insert"} onClick={() => setOpen(open === "insert" ? null : "insert")}>
              <ImagePlus />
            </ToolButton>
          </div>
        </PopoverAnchor>
        <PopoverContent side={side} className="w-64 space-y-1">
          <p className="pb-1 text-sm font-medium">Einfügen</p>
          {([
            ["image", "Bild …", <ImagePlus key="i" />],
            ["screenshot", "Screenshot-Ausschnitt", <Crop key="c" />],
            ["table", "Tabelle", <Table key="t" />],
            ["text", "Textfeld", <Type key="x" />],
            ["pdf", "PDF-Seiten …", <FileUp key="p" />],
            ["plot", "Funktionsgraph …", <LineChart key="g" />],
            ["calc", "Taschenrechner", <Calculator key="r" />],
          ] as [InsertKind, string, ReactNode][]).map(([k, label, icon]) => (
            <Button key={k} variant="ghost" className="h-11 w-full justify-start" onClick={() => { setOpen(null); p.onInsert(k); }}>
              {icon} {label}
            </Button>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">Bilder auch per Strg+V oder Drag &amp; Drop.</p>
        </PopoverContent>
      </Popover>

      <Sep vertical={vertical} />
      <div role="group" aria-label="Stift-Presets" className={cn("flex gap-0.5", vertical ? "flex-col" : "flex-row")}>
        {t.presets.map((pr) => {
          const Icon = PEN_ICONS[pr.pen];
          const active = t.tool === "pen" && t.pen === pr.pen && t.color === pr.color && t.width === pr.width;
          return (
            <div key={pr.id} className="group relative shrink-0">
              <button type="button" aria-label={`Preset ${PENS[pr.pen].label} ${pr.color}`} aria-pressed={active}
                onClick={() => t.applyPreset(pr)}
                className={cn("flex size-11 items-center justify-center rounded-full border-2", active ? "border-ring" : "border-transparent hover:bg-accent")}>
                <span className="flex size-8 items-center justify-center rounded-full" style={{ background: pr.color }}>
                  <Icon className="size-4 text-white mix-blend-difference" />
                </span>
              </button>
              <button type="button" aria-label="Preset entfernen" onClick={() => t.removePreset(pr.id)}
                className="absolute -top-1 -right-1 hidden size-5 items-center justify-center rounded-full bg-destructive text-white group-hover:flex">
                <Trash2 className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      <Sep vertical={vertical} />
      <ToolButton label="Rückgängig" onClick={p.onUndo} className={cn(!p.canUndo && "opacity-40")}><Undo2 /></ToolButton>
      <ToolButton label="Wiederholen" onClick={p.onRedo} className={cn(!p.canRedo && "opacity-40")}><Redo2 /></ToolButton>
      <Sep vertical={vertical} />
      <Button variant="ghost" className="h-11 w-16 shrink-0 tabular-nums" aria-label="Zoom zurücksetzen" title="Zoom zurücksetzen (Strg+Mausrad / zwei Finger zum Zoomen)"
        onClick={() => p.onZoom("reset")}>
        <span ref={p.zoomLabelRef}>100 %</span>
      </Button>

      <Popover open={open === "page"} onOpenChange={(o) => setOpen(o ? "page" : null)}>
        <PopoverAnchor asChild>
          <div>
            <ToolButton label="Blatteinstellungen" active={open === "page"} onClick={() => setOpen(open === "page" ? null : "page")}>
              <Settings2 />
            </ToolButton>
          </div>
        </PopoverAnchor>
        <PageSettings side={side} page={p.page} onChange={p.onPageChange} />
      </Popover>
    </div>
  );
}

function PageSettings({ page, onChange, side }: { page: Page; onChange: (p: PagePatch) => void; side: "top" | "bottom" | "left" | "right" }) {
  const fingerDraws = useTools((s) => s.fingerDraws);
  const setFingerDraws = useTools((s) => s.setFingerDraws);
  return (
    <PopoverContent side={side} className="w-80 space-y-3">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Modus</p>
        <Chips label="Blattmodus" value={page.mode} onChange={(mode) => onChange({ mode })}
          options={[{ value: "infinite", label: "Endlos" }, { value: "a4", label: "DIN A4" }]} />
      </div>
      {page.mode === "a4" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Ausrichtung</p>
          <Chips label="Ausrichtung" value={page.orientation} onChange={(orientation) => onChange({ orientation })}
            options={[{ value: "portrait", label: "Hochformat" }, { value: "landscape", label: "Querformat" }]} />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Hintergrund</p>
        <Chips label="Hintergrund" value={page.background} onChange={(background) => onChange({ background })}
          options={[
            { value: "grid", label: "Kariert" }, { value: "lines", label: "Liniert" },
            { value: "dots", label: "Punktiert" }, { value: "blank", label: "Leer" },
          ]} />
      </div>
      {page.background !== "blank" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Abstand (mm)</p>
          <Chips label="Linienabstand" value={page.bgSpacingMm} onChange={(bgSpacingMm) => onChange({ bgSpacingMm })}
            options={[4, 5, 6, 8, 10].map((v) => ({ value: v, label: String(v) }))} />
        </div>
      )}
      <label className="flex h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={fingerDraws} onChange={(e) => setFingerDraws(e.target.checked)} />
        Mit dem Finger zeichnen (sonst verschieben)
      </label>
    </PopoverContent>
  );
}
