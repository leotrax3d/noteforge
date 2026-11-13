import { useEffect } from "react";
import { Eraser, Lasso, Redo2, Sparkles, Type, Undo2, Wand, X } from "lucide-react";
import type { PenKind } from "@/canvas/core/model";
import { PENS } from "@/canvas/core/pens";
import { PEN_ICONS } from "./Toolbar";
import { useTools } from "./tool-store";

const R = 96;
const BTN = 52;

/** Radialmenü (Stifttaste, Long-Press oder Rechtsklick). */
export function RadialMenu({ at, hostW, hostH, onClose, onUndo, onRedo }: {
  at: { x: number; y: number }; hostW: number; hostH: number; onClose: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const t = useTools();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const pens = (Object.keys(PENS) as PenKind[]).map((k) => ({
    key: k, label: PENS[k].label, Icon: PEN_ICONS[k], active: t.tool === "pen" && t.pen === k, color: t.perPen[k].color,
    run: () => t.setPen(k),
  }));
  const items = [
    ...pens,
    { key: "eraser", label: "Radierer", Icon: Eraser, active: t.tool === "eraser", color: undefined, run: () => t.setTool("eraser") },
    { key: "lasso", label: "Lasso", Icon: Lasso, active: t.tool === "lasso", color: undefined, run: () => t.setTool("lasso") },
    { key: "laser", label: "Laserpointer", Icon: Wand, active: t.tool === "laser", color: undefined, run: () => t.setTool("laser") },
    { key: "vanish", label: "Verschwindende Tinte", Icon: Sparkles, active: t.tool === "vanish", color: undefined, run: () => t.setTool("vanish") },
    { key: "text", label: "Text", Icon: Type, active: t.tool === "text", color: undefined, run: () => t.setTool("text") },
    { key: "undo", label: "Rückgängig", Icon: Undo2, active: false, color: undefined, run: onUndo },
    { key: "redo", label: "Wiederholen", Icon: Redo2, active: false, color: undefined, run: onRedo },
  ];
  const m = R + BTN / 2 + 4;
  const cx = Math.min(Math.max(at.x, m), Math.max(m, hostW - m));
  const cy = Math.min(Math.max(at.y, m), Math.max(m, hostH - m));

  return (
    <div className="absolute inset-0 z-40" onPointerDown={onClose} data-testid="radial-backdrop">
      <div role="menu" aria-label="Radialmenü" className="absolute" style={{ left: cx, top: cy }} onPointerDown={(e) => e.stopPropagation()}>
        <div data-glass="" className="absolute rounded-full border bg-card/80 shadow-2xl backdrop-blur"
          style={{ width: 2 * m, height: 2 * m, left: -m, top: -m }} />
        {items.map((it, i) => {
          const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
          return (
            <button key={it.key} type="button" role="menuitem" aria-label={it.label} title={it.label}
              onClick={() => { it.run(); onClose(); }}
              className={`absolute flex items-center justify-center rounded-full border shadow-sm ${it.active ? "bg-secondary ring-2 ring-ring" : "bg-card hover:bg-accent"}`}
              style={{ width: BTN, height: BTN, left: Math.cos(a) * R - BTN / 2, top: Math.sin(a) * R - BTN / 2 }}>
              <it.Icon className="size-5" />
              {it.color && <span className="absolute right-2 bottom-2 size-2.5 rounded-full border border-black/10" style={{ background: it.color }} />}
            </button>
          );
        })}
        <button type="button" aria-label="Menü schließen" onClick={onClose}
          className="absolute flex size-11 items-center justify-center rounded-full bg-muted" style={{ left: -22, top: -22 }}>
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
