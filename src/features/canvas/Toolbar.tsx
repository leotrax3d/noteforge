import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Calculator, Check, LineChart, Palette, RotateCcw, SlidersHorizontal, X, ZoomIn,
  Crop, DraftingCompass, Eraser, GripVertical, Hand, Highlighter, ImagePlus, Lasso, Pen, PenTool, Pencil, Plus, Redo2, Ruler,
  Settings2, Shapes, Table, Trash2, TriangleRight, Type, Undo2, FileUp,
  Angle, MoveRight, PaintBucket, ScanSearch, Sparkles, Wand,
} from "lucide-react";
import { HEADS, HEAD_LABELS, type Head } from "@/canvas/vector/vec";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PenKind } from "@/canvas/core/model";
import { PENS } from "@/canvas/core/pens";
import type { Page, PagePatch } from "@/lib/types";
import { DEFAULT_HATCH, HIGHLIGHTS, MAX_PRESET_COUNT, PALETTE, TOOL_ITEMS, useTools, type BarSize, type Dock, type ToolItem } from "./tool-store";

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

export type InsertKind = "image" | "screenshot" | "table" | "text" | "pdf" | "plot" | "calc" | "shapes";

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

/** Bezeichnung + Tastenkürzel je Element (Tooltips, Ablage). */
export const ITEM_INFO: Record<ToolItem, { label: string; key?: string }> = {
  fountain: { label: "Füller", key: "B" }, ballpoint: { label: "Kugelschreiber" }, pencil: { label: "Bleistift" },
  highlighter: { label: "Textmarker", key: "M" }, eraser: { label: "Radierer", key: "E" }, lasso: { label: "Lasso", key: "L" },
  pan: { label: "Verschieben", key: "H" }, text: { label: "Text", key: "T" }, guides: { label: "Hilfsmittel", key: "R = Formmodus" },
  insert: { label: "Einfügen" }, presets: { label: "Stift-Presets", key: "1–9" }, undo: { label: "Rückgängig", key: "Strg+Z" },
  redo: { label: "Wiederholen", key: "Strg+Y" }, zoom: { label: "Zoom", key: "Strg+0" }, page: { label: "Blatteinstellungen" },
  calc: { label: "Taschenrechner", key: "Strg+Umschalt+R" }, plot: { label: "Funktionsgraph", key: "Strg+Umschalt+G" }, image: { label: "Bild einfügen", key: "Strg+V" },
  shapes: { label: "Formen-Bibliothek", key: "S" }, heads: { label: "Pfeilspitzen" }, fill: { label: "Füllen", key: "F" },
  angle: { label: "Winkel messen", key: "W" }, zoomwrite: { label: "Zoom-Schreibfeld", key: "Z" },
  laser: { label: "Laserpointer", key: "P" }, vanish: { label: "Verschwindende Tinte", key: "V" },
};
const ITEM_ICON: Record<ToolItem, ReactNode> = {
  fountain: <PenTool />, ballpoint: <Pen />, pencil: <Pencil />, highlighter: <Highlighter />, eraser: <Eraser />, lasso: <Lasso />,
  pan: <Hand />, text: <Type />, guides: <Ruler />, insert: <ImagePlus />, presets: <Palette />, undo: <Undo2 />, redo: <Redo2 />,
  zoom: <ZoomIn />, page: <Settings2 />, calc: <Calculator />, plot: <LineChart />, image: <ImagePlus />,
  shapes: <Shapes />, heads: <MoveRight />, fill: <PaintBucket />, angle: <Angle />, zoomwrite: <ScanSearch />,
  laser: <Wand />, vanish: <Sparkles />,
};

/** Kleine Vorschau einer Pfeilspitze (für Auswahl-Chips). */
export function HeadIcon({ head, flip }: { head: Head; flip?: boolean }) {
  const d = { none: "", arrow: "M15 3L21 8L15 13", filled: "M14 3L21 8L14 13Z", vector: "M13 3L21 8L13 13L16 8Z", dot: "" }[head];
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6" style={flip ? { transform: "scaleX(-1)" } : undefined} aria-hidden>
      <path d="M2 8H19" stroke="currentColor" strokeWidth="2" fill="none" />
      {d && <path d={d} stroke="currentColor" strokeWidth="2" fill={head === "arrow" ? "none" : "currentColor"} strokeLinejoin="round" />}
      {head === "dot" && <circle cx="20" cy="8" r="3" fill="currentColor" />}
    </svg>
  );
}

/** Pfeilspitzen-Auswahl für Anfang und Ende. */
export function HeadPicker({ head0, head1, onChange }: { head0: Head; head1: Head; onChange: (h: Partial<{ head0: Head; head1: Head }>) => void }) {
  return (
    <div className="space-y-2">
      {(["head0", "head1"] as const).map((k) => (
        <div key={k} className="space-y-1">
          <p className="text-xs text-muted-foreground">{k === "head0" ? "Anfang" : "Ende"}</p>
          <div role="radiogroup" aria-label={k === "head0" ? "Spitze am Anfang" : "Spitze am Ende"} className="flex flex-wrap gap-1">
            {HEADS.map((h) => {
              const on = (k === "head0" ? head0 : head1) === h;
              return (
                <Button key={h} role="radio" aria-checked={on} variant={on ? "secondary" : "outline"} title={HEAD_LABELS[h]} aria-label={HEAD_LABELS[h]}
                  className={cn("h-11 min-w-11 px-2", on && "ring-2 ring-ring")} onClick={() => onChange({ [k]: h })}>
                  <HeadIcon head={h} flip={k === "head0"} />
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
export const tip = (i: ToolItem) => ITEM_INFO[i].key ? `${ITEM_INFO[i].label} (${ITEM_INFO[i].key})` : ITEM_INFO[i].label;
const SIZE_PX: Record<BarSize, number> = { s: 44, m: 48, l: 56 };

export function Toolbar(p: ToolbarProps) {
  const t = useTools();
  const [open, setOpen] = useState<null | "pen" | "eraser" | "page" | "guides" | "insert" | "bar" | "preset" | "heads" | "fill" | "vanish">(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [presetEdit, setPresetEdit] = useState<string | null>(null);
  const [reorder, setReorder] = useState<{ item: ToolItem; over: number | null; fromTray: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const vertical = t.orient === "vertical";
  const px = SIZE_PX[t.size];

  const onPen = (pen: PenKind) => {
    if (t.tool === "pen" && t.pen === pen) setOpen(open === "pen" ? null : "pen");
    else t.setPen(pen);
  };
  const onEraser = () => {
    if (t.tool === "eraser") setOpen(open === "eraser" ? null : "eraser");
    else t.setTool("eraser");
  };

  // Ziehen am Griff: frei verschieben; nahe einer Kante andocken, sonst frei schweben.
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
      const d: [Dock, number][] = [["top", y], ["left", x], ["right", 1 - x], ["bottom", 1 - y]];
      d.sort((a, b) => a[1] - b[1]);
      if (d[0][1] < 0.12) t.setDock(d[0][0]);
      else t.setFloat({ x: Math.min(0.95, Math.max(0.05, x)), y: Math.min(0.95, Math.max(0.05, y)) });
      setDrag(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // Bearbeiten-Modus: Elemente per Ziehen (Stift/Finger/Maus) umsortieren, in die Ablage ziehen = entfernen
  const startReorder = (e: React.PointerEvent, item: ToolItem, fromTray: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let over: number | null = null;
    const move = (ev: PointerEvent) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-bar-index]");
      over = hit ? Number(hit.dataset.barIndex) : document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-tool-tray]") ? -1 : null;
      setReorder({ item, over, fromTray });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const items = t.items.filter((i) => i !== item);
      if (over === -1) t.setItems(items); // in die Ablage → entfernen
      else if (over != null) {
        const at = Math.min(items.length, over);
        t.setItems([...items.slice(0, at), item, ...items.slice(at)]);
      } else if (fromTray) t.setItems([...items, item]); // Tipp auf Ablage-Element → hinten anfügen
      setReorder(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    setReorder({ item, over: null, fromTray });
  };

  const dockClass: Record<Dock, string> = {
    top: "top-3 left-1/2 -translate-x-1/2",
    bottom: "bottom-3 left-1/2 -translate-x-1/2",
    left: "left-3 top-1/2 -translate-y-1/2",
    right: "right-3 top-1/2 -translate-y-1/2",
    float: "-translate-x-1/2 -translate-y-1/2",
  };
  const side = t.dock === "top" ? "bottom" : t.dock === "bottom" ? "top" : t.dock === "left" ? "right" : t.dock === "right" ? "left" : vertical ? "right" : "bottom";
  const isHl = t.pen === "highlighter";
  const hidden = TOOL_ITEMS.filter((i) => !t.items.includes(i));

  const render = (item: ToolItem): ReactNode => {
    const label = tip(item);
    switch (item) {
      case "fountain": case "ballpoint": case "pencil": case "highlighter": {
        const active = t.tool === "pen" && t.pen === item;
        const Icon = PEN_ICONS[item];
        return (
          <ToolButton label={label} active={active} onClick={() => onPen(item)}>
            <Icon />
            <span className="absolute right-1.5 bottom-1.5 size-2.5 rounded-full border border-black/10" style={{ background: t.perPen[item].color }} />
          </ToolButton>
        );
      }
      case "eraser": return <ToolButton label={label} active={t.tool === "eraser"} onClick={onEraser}><Eraser /></ToolButton>;
      case "lasso": return <ToolButton label={label} active={t.tool === "lasso"} onClick={() => t.setTool("lasso")}><Lasso /></ToolButton>;
      case "pan": return <ToolButton label={label} active={t.tool === "pan"} onClick={() => t.setTool("pan")}><Hand /></ToolButton>;
      case "text": return <ToolButton label={label} active={t.tool === "text"} onClick={() => t.setTool("text")}><Type /></ToolButton>;
      case "guides":
        return <ToolButton label={label} active={open === "guides" || t.shapeMode || Object.values(t.guides).some(Boolean)}
          onClick={() => setOpen(open === "guides" ? null : "guides")}><Ruler /></ToolButton>;
      case "insert": return <ToolButton label={label} active={open === "insert"} onClick={() => setOpen(open === "insert" ? null : "insert")}><ImagePlus /></ToolButton>;
      case "image": return <ToolButton label={label} onClick={() => p.onInsert("image")}><ImagePlus /></ToolButton>;
      case "calc": return <ToolButton label={label} onClick={() => p.onInsert("calc")}><Calculator /></ToolButton>;
      case "plot": return <ToolButton label={label} onClick={() => p.onInsert("plot")}><LineChart /></ToolButton>;
      case "undo": return <ToolButton label={label} onClick={p.onUndo} className={cn(!p.canUndo && "opacity-40")}><Undo2 /></ToolButton>;
      case "redo": return <ToolButton label={label} onClick={p.onRedo} className={cn(!p.canRedo && "opacity-40")}><Redo2 /></ToolButton>;
      case "zoom":
        return (
          <Button variant="ghost" className="h-11 w-16 shrink-0 tabular-nums" aria-label="Zoom zurücksetzen" title="Zoom zurücksetzen (Strg+0 · Strg+Mausrad / zwei Finger zum Zoomen)"
            onClick={() => p.onZoom("reset")}>
            <span ref={p.zoomLabelRef}>100 %</span>
          </Button>
        );
      case "shapes": return <ToolButton label={label} onClick={() => p.onInsert("shapes")}><Shapes /></ToolButton>;
      case "heads":
        return (
          <ToolButton label={label} active={open === "heads" || t.head0 !== "none" || t.head1 !== "none"} onClick={() => setOpen(open === "heads" ? null : "heads")}>
            <HeadIcon head={t.head1 === "none" && t.head0 === "none" ? "arrow" : t.head1} />
          </ToolButton>
        );
      case "fill":
        return <ToolButton label={label} active={t.tool === "fill"} onClick={() => (t.tool === "fill" ? setOpen(open === "fill" ? null : "fill") : t.setTool("fill"))}>
          <PaintBucket /><span className="absolute right-1.5 bottom-1.5 size-2.5 rounded-full border border-black/10" style={{ background: t.color }} />
        </ToolButton>;
      case "angle": return <ToolButton label={label} active={t.tool === "angle"} onClick={() => t.setTool("angle")}><Angle /></ToolButton>;
      case "zoomwrite": return <ToolButton label={label} active={t.zoomWrite} onClick={() => t.setZoom({ zoomWrite: !t.zoomWrite })}><ScanSearch /></ToolButton>;
      case "laser": return <ToolButton label={label} active={t.tool === "laser"} onClick={() => t.setTool("laser")}><Wand /></ToolButton>;
      case "vanish":
        return <ToolButton label={label} active={t.tool === "vanish"} onClick={() => (t.tool === "vanish" ? setOpen(open === "vanish" ? null : "vanish") : t.setTool("vanish"))}><Sparkles /></ToolButton>;
      case "page": return <ToolButton label={label} active={open === "page"} onClick={() => setOpen(open === "page" ? null : "page")}><Settings2 /></ToolButton>;
      case "presets":
        return (
          <div role="group" aria-label="Stift-Presets" className={cn("flex gap-0.5", vertical ? "flex-col" : "flex-row")}>
            {t.presets.map((pr, i) => {
              const Icon = PEN_ICONS[pr.pen];
              const active = t.tool === "pen" && t.pen === pr.pen && t.color === pr.color && t.width === pr.width && (t.opacity ?? null) === (pr.opacity ?? null);
              const name = `Preset ${i + 1}: ${PENS[pr.pen].label}, Breite ${pr.width}${pr.opacity != null ? `, ${Math.round(pr.opacity * 100)} %` : ""} (${i + 1}) – lange drücken zum Bearbeiten`;
              return (
                <button key={pr.id} type="button" aria-label={name} title={name} aria-pressed={active}
                  onClick={() => (editing ? (setPresetEdit(pr.id), setOpen("preset")) : t.applyPreset(pr))}
                  onContextMenu={(e) => { e.preventDefault(); setPresetEdit(pr.id); setOpen("preset"); }}
                  className={cn("flex size-11 shrink-0 items-center justify-center rounded-full border-2", active ? "border-ring" : "border-transparent hover:bg-accent")}>
                  <span className="flex size-8 items-center justify-center rounded-full" style={{ background: pr.color, opacity: pr.opacity ?? 1 }}>
                    <Icon className="size-4 text-white mix-blend-difference" />
                  </span>
                </button>
              );
            })}
            <button type="button" aria-label="Neues Preset aus aktuellem Stift" title="Neues Preset aus aktuellem Stift"
              disabled={t.presets.length >= MAX_PRESET_COUNT} onClick={() => { t.addPreset(); }}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-40"><Plus className="size-4" /></button>
          </div>
        );
    }
  };

  const editPreset = t.presets.find((x) => x.id === presetEdit) ?? null;

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Werkzeugleiste"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      data-dock={t.dock}
      data-size={t.size}
      className={cn(
        "absolute z-20 flex items-center gap-1 rounded-2xl border bg-card/95 p-1.5 shadow-xl backdrop-blur",
        vertical ? "max-h-[calc(100%-24px)] flex-col overflow-y-auto" : "w-max max-w-[calc(100%-24px)] flex-row flex-wrap justify-center",
        drag ? "pointer-events-auto opacity-80" : dockClass[t.dock],
        editing && "ring-2 ring-primary",
      )}
      style={{
        ...(drag ? { left: drag.x, top: drag.y, transform: "translate(-22px, -22px)" } : t.dock === "float" ? { left: `${t.floatPos.x * 100}%`, top: `${t.floatPos.y * 100}%` } : {}),
        // Größe: Schaltflächen skalieren (mind. 44 px Touch-Ziel)
        zoom: px / 44,
      } as React.CSSProperties}
    >
      <button type="button" aria-label="Werkzeugleiste verschieben" title="Ziehen: an Kante andocken oder frei ablegen"
        onPointerDown={onGrip}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing">
        <GripVertical className={cn("size-5", !vertical && "rotate-90")} />
      </button>

      {t.items.map((item, i) => (
        <div key={item} data-bar-index={i} data-item={item}
          className={cn("relative flex shrink-0", vertical ? "flex-col" : "flex-row",
            editing && "rounded-xl border border-dashed border-primary/60 touch-none",
            reorder?.item === item && "opacity-40",
            reorder && reorder.over === i && (vertical ? "border-t-4 border-t-primary" : "border-l-4 border-l-primary"))}
          onPointerDownCapture={editing ? (e) => startReorder(e, item, false) : undefined}>
          {editing ? <div className="pointer-events-none flex">{render(item)}</div> : render(item)}
          {editing && (
            <button type="button" aria-label={`${ITEM_INFO[item].label} entfernen`} title="Entfernen"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={() => t.setItems(t.items.filter((x) => x !== item))}
              className="absolute -top-2 -right-2 z-10 flex size-6 items-center justify-center rounded-full bg-destructive text-white shadow">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}

      <Sep vertical={vertical} />
      <ToolButton label={editing ? "Bearbeiten beenden" : "Leiste anpassen"} active={editing} onClick={() => { setEditing(!editing); setOpen(editing ? null : "bar"); }}>
        {editing ? <Check /> : <SlidersHorizontal />}
      </ToolButton>

      {/* Popover-Inhalte (an der Leiste verankert) */}
      <Popover open={open === "pen"} onOpenChange={(o) => setOpen(o ? "pen" : null)}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
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
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        <PopoverContent side={side} className="space-y-3">
          <p className="text-sm font-medium">Radierer</p>
          <Chips label="Radiermodus" value={t.eraserMode} onChange={(m) => t.setEraser({ eraserMode: m })}
            options={[{ value: "stroke", label: "Ganze Striche" }, { value: "partial", label: "Teilweise" }]} />
          <Chips label="Radiergröße" value={t.eraserSize} onChange={(s) => t.setEraser({ eraserSize: s })}
            options={[{ value: 8, label: "S" }, { value: 14, label: "M" }, { value: 24, label: "L" }, { value: 40, label: "XL" }]} />
          <p className="text-xs text-muted-foreground">Tipp: Das Radierende des Stifts wird automatisch erkannt.</p>
        </PopoverContent>
      </Popover>

      <Popover open={open === "guides"} onOpenChange={(o) => setOpen(o ? "guides" : null)}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
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
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
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
          <p className="pt-1 text-xs text-muted-foreground">Bilder und PDFs auch per Strg+V oder Drag &amp; Drop.</p>
        </PopoverContent>
      </Popover>

      <Popover open={open === "heads"} onOpenChange={(o) => setOpen(o ? "heads" : null)}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        <PopoverContent side={side} className="w-80 space-y-2">
          <p className="text-sm font-medium">Pfeilspitzen</p>
          <HeadPicker head0={t.head0} head1={t.head1} onChange={t.setHeads} />
          <p className="text-xs text-muted-foreground">Gilt für Linien am Lineal und für Freihand → Linie/Pfeil. Nachträglich: Linie mit dem Lasso auswählen.</p>
        </PopoverContent>
      </Popover>

      <Popover open={open === "fill"} onOpenChange={(o) => setOpen(o ? "fill" : null)}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        <PopoverContent side={side} className="w-80 space-y-3">
          <p className="text-sm font-medium">Füllen</p>
          <ColorGrid value={t.color} onPick={t.setColor} />
          <Chips label="Füllart" value={t.fillHatch ? "hatch" : "solid"} onChange={(v) => t.setFill({ fillHatch: v === "hatch" ? (t.fillHatch ?? DEFAULT_HATCH) : null })}
            options={[{ value: "solid", label: "Farbe" }, { value: "hatch", label: "Schraffur" }]} />
          <div className="space-y-1">
            <Label htmlFor="fill-op" className="text-xs text-muted-foreground">Deckkraft {Math.round(t.fillOpacity * 100)} %</Label>
            <input id="fill-op" type="range" min={10} max={100} step={5} className="h-11 w-full" value={Math.round(t.fillOpacity * 100)}
              onChange={(e) => t.setFill({ fillOpacity: Number(e.target.value) / 100 })} />
          </div>
          {t.fillHatch && (
            <>
              <Chips label="Schraffur-Winkel" value={t.fillHatch.angle} onChange={(angle) => t.setFill({ fillHatch: { ...t.fillHatch!, angle } })}
                options={[0, 45, 90, 135].map((v) => ({ value: v, label: `${v}°` }))} />
              <Chips label="Schraffur-Abstand" value={Math.round(t.fillHatch.gap / (DEFAULT_HATCH.gap / 3))} onChange={(mm) => t.setFill({ fillHatch: { ...t.fillHatch!, gap: mm * (DEFAULT_HATCH.gap / 3) } })}
                options={[2, 3, 5, 8].map((v) => ({ value: v, label: `${v} mm` }))} />
            </>
          )}
          <p className="text-xs text-muted-foreground">Geschlossene Form oder Freihand-Bereich antippen. Lücken bis 2 mm werden überbrückt. Die Füllung liegt unter der Tinte.</p>
        </PopoverContent>
      </Popover>

      <Popover open={open === "vanish"} onOpenChange={(o) => setOpen(o ? "vanish" : null)}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        <PopoverContent side={side} className="w-72 space-y-2">
          <p className="text-sm font-medium">Verschwindende Tinte</p>
          <Chips label="Sichtbar für" value={t.vanishMs} onChange={t.setVanishMs}
            options={[1000, 2000, 4000, 8000].map((v) => ({ value: v, label: `${v / 1000} s` }))} />
          <p className="text-xs text-muted-foreground">Zum Zeigen und Erklären – nichts davon wird gespeichert.</p>
        </PopoverContent>
      </Popover>

      <Popover open={open === "page"} onOpenChange={(o) => setOpen(o ? "page" : null)}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        <PageSettings side={side} page={p.page} onChange={p.onPageChange} />
      </Popover>

      {/* Bearbeiten-Modus: Werkzeug-Ablage + Lage/Größe */}
      <Popover open={editing && open === "bar"} onOpenChange={(o) => { if (!o && !reorder) { setOpen(null); setEditing(false); } }}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        <PopoverContent side={side} className="w-96 space-y-3" onInteractOutside={(e) => reorder && e.preventDefault()}>
          <p className="text-sm font-medium">Leiste anpassen</p>
          <p className="text-xs text-muted-foreground">Elemente in der Leiste ziehen zum Umsortieren, in die Ablage ziehen (oder ×) zum Entfernen. Aus der Ablage in die Leiste ziehen oder antippen zum Hinzufügen.</p>
          <div data-tool-tray aria-label="Werkzeug-Ablage" role="group"
            className={cn("flex min-h-14 flex-wrap gap-1 rounded-lg border border-dashed p-1.5", reorder?.over === -1 && "bg-destructive/10")}>
            {hidden.length === 0 && <span className="self-center px-2 text-sm text-muted-foreground">Alle Werkzeuge sind in der Leiste.</span>}
            {hidden.map((i) => (
              <button key={i} type="button" aria-label={`${ITEM_INFO[i].label} hinzufügen`} title={`${ITEM_INFO[i].label} – ziehen oder antippen`}
                onPointerDown={(e) => startReorder(e, i, true)}
                className="flex size-11 touch-none items-center justify-center rounded-md border bg-background hover:bg-accent [&_svg]:size-5">
                {ITEM_ICON[i]}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Ausrichtung</p>
            <Chips label="Ausrichtung" value={t.orient} onChange={t.setOrient}
              options={[{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertikal" }]} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Position</p>
            <Chips label="Position" value={t.dock} onChange={(d) => (d === "float" ? t.setFloat(t.floatPos) : t.setDock(d))}
              options={[{ value: "top", label: "Oben" }, { value: "left", label: "Links" }, { value: "right", label: "Rechts" }, { value: "float", label: "Schwebend" }]} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Größe</p>
            <Chips label="Größe" value={t.size} onChange={t.setSize}
              options={[{ value: "s", label: "Klein" }, { value: "m", label: "Mittel" }, { value: "l", label: "Groß" }]} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" onClick={() => t.resetBar()}><RotateCcw /> Zurücksetzen</Button>
            <Button className="ml-auto h-11" onClick={() => { setEditing(false); setOpen(null); }}><Check /> Fertig</Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Preset bearbeiten (Typ, Farbe, Breite, Deckkraft) */}
      <Popover open={open === "preset" && !!editPreset} onOpenChange={(o) => { if (!o) { setOpen(editing ? "bar" : null); setPresetEdit(null); } }}>
        <PopoverAnchor asChild><span className="absolute inset-0 -z-10" aria-hidden /></PopoverAnchor>
        {editPreset && (
          <PopoverContent side={side} className="w-80 space-y-3">
            <p className="text-sm font-medium">Preset bearbeiten</p>
            <Chips label="Stifttyp" value={editPreset.pen}
              onChange={(pen) => t.updatePreset(editPreset.id, { pen, width: PENS[pen].widths.includes(editPreset.width) ? editPreset.width : PENS[pen].defaultWidth })}
              options={(Object.keys(PENS) as PenKind[]).map((k) => ({ value: k, label: PENS[k].label }))} />
            <ColorGrid value={editPreset.color} onPick={(color) => t.updatePreset(editPreset.id, { color })} highlight={editPreset.pen === "highlighter"} />
            <Chips label="Breite" value={editPreset.width} onChange={(width) => t.updatePreset(editPreset.id, { width })}
              options={PENS[editPreset.pen].widths.map((w) => ({ value: w, label: String(w) }))} />
            <div className="space-y-1">
              <Label htmlFor="preset-op" className="text-xs text-muted-foreground">Deckkraft {Math.round((editPreset.opacity ?? PENS[editPreset.pen].opacity) * 100)} %</Label>
              <input id="preset-op" type="range" min={10} max={100} step={5} className="h-11 w-full"
                value={Math.round((editPreset.opacity ?? PENS[editPreset.pen].opacity) * 100)}
                onChange={(e) => t.updatePreset(editPreset.id, { opacity: Number(e.target.value) / 100 })} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 text-destructive" onClick={() => { t.removePreset(editPreset.id); setPresetEdit(null); setOpen(editing ? "bar" : null); }}><Trash2 /> Löschen</Button>
              <Button className="ml-auto h-11" onClick={() => { t.applyPreset(editPreset); setPresetEdit(null); setOpen(editing ? "bar" : null); }}><Check /> Verwenden</Button>
            </div>
          </PopoverContent>
        )}
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
