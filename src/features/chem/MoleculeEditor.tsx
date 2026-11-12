// Strukturformel-Editor (SPEC §4.4): fast Vollbild, eigenes Zeichenfeld, Live-Vorschau der drei Darstellungen.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Eraser, Hexagon, PenLine, Redo2, Undo2, Wand2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  BOND, ELEMENTS, GROUPS, VIEW_LABELS, addAtom, atomNear, attachGroup, bondNear, cycleBond, emptyMol, fromMolfile, grow, implicitH,
  molInfo, neighbors, relayout, removeAtom, removeBond, setElement, snapDir, subscript, toMolfile, valenceErrors,
  type Mol, type MolData, type MolView,
} from "./mol";
import { renderMol, type MolSvg } from "./render";

type DrawMode = "skeletal" | "full";
const PX = 44; // Pixel je Bindung bei Zoom 1

export function MoleculeEditor({ open, initial, onOpenChange, onInsert }: {
  open: boolean;
  initial: MolData | null;
  onOpenChange: (o: boolean) => void;
  onInsert: (d: MolData, svg: MolSvg) => void;
}) {
  const [mol, setMol] = useState<Mol>(emptyMol);
  const [past, setPast] = useState<Mol[]>([]);
  const [future, setFuture] = useState<Mol[]>([]);
  const [mode, setMode] = useState<DrawMode>("skeletal");
  const [tool, setTool] = useState<"draw" | "erase">("draw");
  const [view, setView] = useState<MolView>("skeletal");
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState<number | null>(null);
  const [radial, setRadial] = useState<{ id: number; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const drag = useRef<{ cur: Mol; start: Mol; tip: number | null; down: { x: number; y: number }; moved: boolean; hitBond: number; hitAtom: number | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    let m = emptyMol();
    try { if (initial) m = fromMolfile(initial.molfile); } catch (e) { console.warn(e); }
    setMol(m); setPast([]); setFuture([]); setActive(null); setRadial(null); setZoom(1); setTool("draw");
    setView(initial?.view ?? "skeletal");
    setMode(initial?.view === "full" ? "full" : "skeletal");
  }, [open, initial]);

  // Callback-Ref: das Zeichenfeld wird bei jedem Öffnen neu eingehängt
  const roRef = useRef<ResizeObserver | null>(null);
  const setBox = useCallback((el: HTMLDivElement | null) => {
    boxRef.current = el;
    roRef.current?.disconnect();
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
    roRef.current = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    roRef.current.observe(el);
  }, []);

  const commit = (before: Mol, after: Mol) => {
    if (before === after) return;
    setPast((p) => [...p.slice(-99), before]);
    setFuture([]);
    setMol(after);
  };
  const undo = () => { if (!past.length) return; setFuture((f) => [mol, ...f]); setMol(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setActive(null); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, mol]); setMol(future[0]); setFuture((f) => f.slice(1)); };

  const errors = useMemo(() => valenceErrors(mol), [mol]);
  const info = useMemo(() => molInfo(mol), [mol]);
  const previews = useMemo(() => (["full", "condensed", "skeletal"] as MolView[]).map((v) => [v, renderMol(mol, v, "currentColor")] as const), [mol]);

  const s = PX * zoom;
  const toModel = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - size.w / 2) / s, y: (e.clientY - r.top - size.h / 2) / s };
  };
  const toPx = (x: number, y: number) => ({ x: x * s + size.w / 2, y: y * s + size.h / 2 });
  const ortho = mode === "full";

  const onDown = (e: RPointerEvent) => {
    if (e.button > 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setRadial(null);
    const p = toModel(e);
    const a = atomNear(mol, p.x, p.y, 0.35);
    const b = a ? -1 : bondNear(mol, p.x, p.y, 0.2);
    if (tool === "erase") {
      if (a) commit(mol, removeAtom(mol, a.id));
      else if (b >= 0) commit(mol, removeBond(mol, b));
      drag.current = null;
      return;
    }
    drag.current = { cur: mol, start: mol, tip: a?.id ?? null, down: p, moved: false, hitBond: b, hitAtom: a?.id ?? null };
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toModel(e);
    if (!d.moved && Math.hypot(p.x - d.down.x, p.y - d.down.y) < 0.3) return;
    d.moved = true;
    let m = d.cur, tip = d.tip;
    if (tip == null) {
      [m, tip] = addAtom(m, "C", d.down.x, d.down.y);
    }
    // so viele Bindungen anhängen, wie der Stift weitergezogen wurde
    for (let guard = 0; guard < 8; guard++) {
      const t = m.atoms.find((x) => x.id === tip)!;
      if (Math.hypot(p.x - t.x, p.y - t.y) < BOND * 0.8) break;
      const dir = snapDir(m, tip!, Math.atan2(p.y - t.y, p.x - t.x), ortho);
      const [m2, n] = grow(m, tip!, dir);
      if (m2 === m) break;
      m = m2; tip = n;
    }
    d.tip = tip;
    if (m !== d.cur) { d.cur = m; setMol(m); setActive(tip); }
  };

  const onUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) { if (d.cur !== d.start) { setPast((p) => [...p.slice(-99), d.start]); setFuture([]); } return; }
    if (d.hitAtom != null) {
      setActive(d.hitAtom);
      const r = boxRef.current!.getBoundingClientRect();
      setRadial({ id: d.hitAtom, x: e.clientX - r.left, y: e.clientY - r.top });
    } else if (d.hitBond >= 0) commit(mol, cycleBond(mol, d.hitBond));
    else {
      const [m, id] = addAtom(mol, "C", d.down.x, d.down.y);
      commit(mol, m);
      setActive(id);
    }
  };

  const group = (g: (typeof GROUPS)[number]["id"]) => {
    const [m, at] = attachGroup(mol, active, g, ortho);
    commit(mol, m);
    setActive(at);
  };

  const insert = () => {
    if (!mol.atoms.length) return;
    onInsert({ molfile: toMolfile(mol), view }, renderMol(mol, view));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && active != null && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault(); commit(mol, removeAtom(mol, active)); setActive(null);
    }
  };

  // ---------- Zeichenfeld ----------
  const atomById = new Map(mol.atoms.map((a) => [a.id, a]));
  const lines: React.ReactNode[] = [];
  mol.bonds.forEach((b, i) => {
    const p = toPx(atomById.get(b.a)!.x, atomById.get(b.a)!.y), q = toPx(atomById.get(b.b)!.x, atomById.get(b.b)!.y);
    const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const offs = b.order === 1 ? [0] : b.order === 2 ? [-3, 3] : [-5, 0, 5];
    lines.push(
      <g key={`b${i}`} data-bond={i}>
        <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="transparent" strokeWidth={22} />
        {offs.map((o) => <line key={o} x1={p.x + nx * o} y1={p.y + ny * o} x2={q.x + nx * o} y2={q.y + ny * o} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />)}
      </g>,
    );
  });
  const atoms = mol.atoms.map((a) => {
    const p = toPx(a.x, a.y), err = errors.get(a.id), h = implicitH(mol, a), nb = neighbors(mol, a.id);
    const showLabel = mode === "full" || a.el !== "C" || nb.length === 0;
    const hs: React.ReactNode[] = [];
    if (mode === "full" && h) {
      // H hellgrau in freie Richtungen
      const used = nb.map((n) => Math.atan2(atomById.get(n)!.y - a.y, atomById.get(n)!.x - a.x));
      const cand = [-Math.PI / 2, Math.PI / 2, Math.PI, 0, -Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
      cand.filter((c) => used.every((u) => Math.abs(Math.atan2(Math.sin(c - u), Math.cos(c - u))) > 0.6)).slice(0, h).forEach((c, k) => {
        const x = p.x + Math.cos(c) * s * 0.7, y = p.y + Math.sin(c) * s * 0.7;
        hs.push(<g key={k} className="text-muted-foreground"><line x1={p.x + Math.cos(c) * 10} y1={p.y + Math.sin(c) * 10} x2={x - Math.cos(c) * 7} y2={y - Math.sin(c) * 7} stroke="currentColor" strokeWidth={1.2} /><text x={x} y={y + 5} textAnchor="middle" fontSize={14} fill="currentColor">H</text></g>);
      });
    }
    const label = showLabel ? (mode === "full" || a.el === "H" ? a.el : `${a.el}${h ? `H${h > 1 ? subscript(String(h)) : ""}` : ""}`) : null;
    return (
      <g key={a.id} data-atom={a.id} data-el={a.el}>
        {hs}
        {err && <circle cx={p.x} cy={p.y} r={15} fill="rgb(239 68 68 / 0.18)" stroke="rgb(239 68 68)" strokeWidth={2}><title>{err}</title></circle>}
        {active === a.id && <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="var(--color-primary, #2563eb)" strokeWidth={2} strokeDasharray="3 3" />}
        {label ? (
          <>
            <rect x={p.x - 8 - (label.length - 1) * 4.5} y={p.y - 11} width={16 + (label.length - 1) * 9} height={22} rx={4} className="fill-background" />
            <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize={17} fill={err ? "rgb(220 38 38)" : "currentColor"}>{label}{err && <title>{err}</title>}</text>
          </>
        ) : <circle cx={p.x} cy={p.y} r={3} fill="currentColor" opacity={0.35} />}
        <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
      </g>
    );
  });

  const errList = [...errors.values()];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] max-w-[97vw] flex-col gap-2 p-3 sm:max-w-[97vw]" data-testid="molecule-editor" onKeyDown={onKey}>
        <div className="flex flex-wrap items-center gap-2 pr-10">
          <DialogTitle className="mr-2">Strukturformel</DialogTitle>
          <DialogDescription className="sr-only">Molekül zeichnen, Darstellung wählen und ins Blatt einfügen.</DialogDescription>
          <div role="radiogroup" aria-label="Zeichenmodus" className="flex rounded-lg border p-0.5">
            {(["skeletal", "full"] as DrawMode[]).map((m) => (
              <Button key={m} role="radio" aria-checked={mode === m} variant={mode === m ? "secondary" : "ghost"} className="h-11"
                onClick={() => setMode(m)}>{m === "skeletal" ? "Skelettformel" : "Volle Strukturformel"}</Button>
            ))}
          </div>
          <div className="flex rounded-lg border p-0.5">
            <Button variant={tool === "draw" ? "secondary" : "ghost"} size="icon" className="size-11" aria-label="Zeichnen" title="Zeichnen" aria-pressed={tool === "draw"} onClick={() => setTool("draw")}><PenLine /></Button>
            <Button variant={tool === "erase" ? "secondary" : "ghost"} size="icon" className="size-11" aria-label="Radierer" title="Radierer (Atom/Bindung antippen)" aria-pressed={tool === "erase"} onClick={() => setTool("erase")}><Eraser /></Button>
          </div>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Rückgängig" title="Rückgängig (Strg+Z)" disabled={!past.length} onClick={undo}><Undo2 /></Button>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Wiederholen" title="Wiederholen (Strg+Y)" disabled={!future.length} onClick={redo}><Redo2 /></Button>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Verkleinern" title="Verkleinern" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}><ZoomOut /></Button>
          <span className="w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)} %</span>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Vergrößern" title="Vergrößern" onClick={() => setZoom((z) => Math.min(3, z * 1.25))}><ZoomIn /></Button>
          <Button variant="ghost" className="h-11" title="Atome neu anordnen (OpenChemLib)" disabled={mol.atoms.length < 2} onClick={() => commit(mol, relayout(mol))}><Wand2 /> Aufräumen</Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[150px_1fr] gap-2 lg:grid-cols-[150px_1fr_minmax(420px,36%)]">
          <aside aria-label="Funktionelle Gruppen" className="flex flex-col gap-1 overflow-y-auto">
            {GROUPS.map((g) => (
              <Button key={g.id} variant="outline" className="h-11 justify-start" title={g.hint} onClick={() => group(g.id)}>
                {g.id === "benzene" && <Hexagon />}{g.label}
              </Button>
            ))}
          </aside>

          <div ref={setBox} className={cn("relative min-h-0 touch-none overflow-hidden rounded-lg border bg-background", tool === "erase" && "cursor-cell")}
            onWheel={(e) => setZoom((z) => Math.min(3, Math.max(0.4, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))}>
            <svg width={size.w} height={size.h} className="block select-none" data-testid="mol-canvas" role="application" aria-label="Zeichenfeld Strukturformel"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)}>
              {lines}
              {atoms}
            </svg>
            {!mol.atoms.length && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground">
                Mit dem Stift ziehen: jede Bindung wird ein C-Atom, Winkel rasten ein. Atom antippen = Element wählen, Bindung antippen = Einfach/Doppel/Dreifach.
              </p>
            )}
            {radial && (
              <div role="menu" aria-label="Element wählen" className="absolute z-10" style={{ left: radial.x, top: radial.y }}>
                {[...ELEMENTS, "×"].map((el, i, all) => {
                  const t = (i / all.length) * 2 * Math.PI - Math.PI / 2, r = 86;
                  return (
                    <button key={el} type="button" role="menuitem" aria-label={el === "×" ? "Atom löschen" : `Element ${el}`}
                      className={cn("absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-base font-medium shadow-md hover:bg-accent",
                        el === "×" && "text-destructive", atomById.get(radial.id)?.el === el && "ring-2 ring-ring")}
                      style={{ left: Math.cos(t) * r, top: Math.sin(t) * r }}
                      onClick={() => {
                        commit(mol, el === "×" ? removeAtom(mol, radial.id) : setElement(mol, radial.id, el));
                        if (el === "×") setActive(null);
                        setRadial(null);
                      }}>{el}</button>
                  );
                })}
              </div>
            )}
          </div>

          <section aria-label="Darstellung wählen" className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1">
            <p className="text-sm font-medium">Darstellung</p>
            <div role="radiogroup" aria-label="Darstellung" className="grid min-h-0 flex-1 grid-cols-3 gap-2 lg:grid-cols-1 lg:overflow-y-auto">
              {previews.map(([v, r]) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} data-view={v}
                  className={cn("flex min-h-28 flex-col rounded-lg border p-2 text-left hover:bg-accent/50", view === v && "border-primary ring-2 ring-ring")}
                  onClick={() => setView(v)}>
                  <span className="text-xs font-medium">{VIEW_LABELS[v]}</span>
                  <span className="flex min-h-0 flex-1 items-center justify-center text-foreground [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: mol.atoms.length ? r.svg.replace(/width="(\d+)" height="(\d+)"/, (_, w) => `width="100%" style="max-width:${Math.round(+w * 1.8)}px;max-height:100%"`) : "" }} />
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t pt-2">
          <p className="text-sm" data-testid="mol-info" aria-live="polite">
            {info ? <>Summenformel <strong>{subscript(info.formula)}</strong> · Molmasse <strong>{info.mass.toLocaleString("de-DE", { maximumFractionDigits: 2 })} g/mol</strong></> : "Noch kein Molekül"}
          </p>
          {errList.length > 0 && <p className="text-sm text-destructive" role="alert">⚠ {errList[0]}{errList.length > 1 ? ` (+${errList.length - 1})` : ""}</p>}
          <Button variant="outline" className="ml-auto h-11" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button className="h-11" disabled={!mol.atoms.length} onClick={insert}>{initial ? "Übernehmen" : "Einfügen"}</Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
