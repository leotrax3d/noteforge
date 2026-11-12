import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator, Crosshair, Delete, FilePlus2, LineChart, Maximize2, Plus, RotateCcw, Trash2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { usePrefs } from "@/store/prefs";
import { useCalc } from "./calc-store";
import { calculate } from "./math";
import {
  MAX_FNS, PLOT_COLORS, POINT_TEXT, analyze, autoY, compileAll, defaultSpec, fmtCoord, fnName, plotSvg, svgDataUrl,
  validRange, zoomSpec, type PlotSpec,
} from "./plot";

/** Schwebendes Rechner-Panel (SPEC Phase 11): Taschenrechner + Funktionsplotter. */
export function CalcPanel() {
  const { open, tab, setTab, toggle } = useCalc();
  const left = usePrefs((s) => s.leftHanded);
  if (!open) return null;
  return (
    <aside role="dialog" aria-label="Rechner" data-testid="calc-panel"
      className={cn("fixed top-14 z-40 flex max-h-[calc(100vh-4.5rem)] w-[min(27rem,calc(100vw-1rem))] flex-col rounded-xl border bg-card shadow-2xl",
        left ? "left-2" : "right-2")}>
      <div className="flex items-center gap-1 border-b p-1" role="tablist" aria-label="Rechner-Modus">
        <TabBtn active={tab === "calc"} onClick={() => setTab("calc")}><Calculator /> Rechner</TabBtn>
        <TabBtn active={tab === "plot"} onClick={() => setTab("plot")}><LineChart /> Graph</TabBtn>
        <Button variant="ghost" size="icon" className="ml-auto" aria-label="Rechner schließen" onClick={() => toggle(false)}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "calc" ? <CalcTab /> : <PlotTab />}
      </div>
    </aside>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn("flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4",
        active ? "bg-secondary" : "text-muted-foreground hover:bg-accent")}>
      {children}
    </button>
  );
}

// ---------- Taschenrechner ----------

const KEYS: { label: string; ins?: string; act?: "clear" | "back" | "eq" | "ans"; wide?: boolean; tone?: "op" | "fn" | "eq" }[] = [
  { label: "sin", ins: "sin(", tone: "fn" }, { label: "cos", ins: "cos(", tone: "fn" }, { label: "tan", ins: "tan(", tone: "fn" }, { label: "(", ins: "(", tone: "fn" }, { label: ")", ins: ")", tone: "fn" },
  { label: "√", ins: "√(", tone: "fn" }, { label: "x²", ins: "²", tone: "fn" }, { label: "xʸ", ins: "^", tone: "fn" }, { label: "ln", ins: "ln(", tone: "fn" }, { label: "log", ins: "log(", tone: "fn" },
  { label: "7", ins: "7" }, { label: "8", ins: "8" }, { label: "9", ins: "9" }, { label: "⌫", act: "back", tone: "op" }, { label: "AC", act: "clear", tone: "op" },
  { label: "4", ins: "4" }, { label: "5", ins: "5" }, { label: "6", ins: "6" }, { label: "×", ins: "×", tone: "op" }, { label: "÷", ins: "÷", tone: "op" },
  { label: "1", ins: "1" }, { label: "2", ins: "2" }, { label: "3", ins: "3" }, { label: "+", ins: "+", tone: "op" }, { label: "−", ins: "−", tone: "op" },
  { label: "0", ins: "0" }, { label: ",", ins: "," }, { label: "π", ins: "π", tone: "fn" }, { label: "Ans", act: "ans", tone: "fn" }, { label: "=", act: "eq", tone: "eq" },
];

function CalcTab() {
  const { mode, setMode, history, push, clearHistory, host } = useCalc();
  const [expr, setExpr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const scope = useRef(new Map<string, unknown>());
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const preview = useMemo(() => {
    if (!expr.trim() || /=/.test(expr)) return null;
    const r = calculate(expr, new Map(scope.current), mode);
    return r.ok && typeof r.value === "number" ? r.text : null;
  }, [expr, mode]);

  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [history.length]);

  const insert = (s: string) => {
    const el = input.current;
    const a = el?.selectionStart ?? expr.length, b = el?.selectionEnd ?? expr.length;
    const next = expr.slice(0, a) + s + expr.slice(b);
    setExpr(next);
    setErr(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + s.length, a + s.length); });
  };
  const run = () => {
    if (!expr.trim()) return;
    const r = calculate(expr, scope.current, mode);
    if (!r.ok) { setErr(r.error); return; }
    push({ expr: expr.trim(), text: r.text });
    setExpr("");
    setErr(null);
  };
  const press = (k: (typeof KEYS)[number]) => {
    if (k.ins) insert(k.ins);
    else if (k.act === "clear") { setExpr(""); setErr(null); }
    else if (k.act === "back") {
      const el = input.current;
      const a = el?.selectionStart ?? expr.length, b = el?.selectionEnd ?? expr.length;
      const from = a === b ? Math.max(0, a - 1) : a;
      setExpr(expr.slice(0, from) + expr.slice(b));
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(from, from); });
    } else if (k.act === "ans") insert("ans");
    else run();
  };
  const last = history[history.length - 1];

  return (
    <div className="grid gap-2 p-2">
      <ol ref={listRef} aria-label="Verlauf" className="max-h-40 min-h-12 overflow-y-auto rounded-lg bg-muted/40 p-1 text-right">
        {history.map((h, i) => (
          <li key={i}>
            <button type="button" className="w-full rounded-md px-2 py-1 text-right outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              title="Ergebnis übernehmen" onClick={() => insert(h.text.includes("·") ? "ans" : h.text)}>
              <div className="truncate text-sm text-muted-foreground">{h.expr}</div>
              <div className="truncate text-lg font-semibold tabular-nums" data-testid="calc-result">= {h.text}</div>
            </button>
          </li>
        ))}
      </ol>
      <form onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Input ref={input} aria-label="Rechnung" data-testid="calc-input" autoComplete="off" spellCheck={false} inputMode="none"
          className="h-12 text-right font-mono text-lg" value={expr} placeholder="0"
          onChange={(e) => { setExpr(e.target.value); setErr(null); }} />
      </form>
      <div className="flex min-h-5 items-center gap-2 px-1 text-sm">
        <span role="status" className={cn("mr-auto truncate", err ? "text-destructive" : "text-muted-foreground")}>{err ?? (preview ? `= ${preview}` : "")}</span>
        <div role="radiogroup" aria-label="Winkelmaß" className="flex rounded-md border">
          {(["deg", "rad"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={cn("h-11 px-3 text-xs font-semibold", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {m === "deg" ? "DEG" : "RAD"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1" aria-label="Tastenfeld">
        {KEYS.map((k) => (
          <button key={k.label} type="button" onClick={() => press(k)} aria-label={k.act === "back" ? "Zeichen löschen" : k.act === "clear" ? "Alles löschen" : k.label}
            className={cn("h-12 rounded-lg text-lg font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95",
              k.tone === "eq" ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : k.tone === "op" ? "bg-secondary hover:bg-secondary/70"
                : k.tone === "fn" ? "bg-muted text-base hover:bg-muted/70" : "border bg-background hover:bg-accent")}>
            {k.act === "back" ? <Delete className="mx-auto size-5" /> : k.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" disabled={!history.length} onClick={() => { clearHistory(); scope.current.clear(); }}><RotateCcw /> Verlauf leeren</Button>
        {host && (
          <Button variant="outline" className="ml-auto" disabled={!last} onClick={() => last && host.insertText(`${last.expr} = ${last.text}`)}>
            <FilePlus2 /> Aufs Blatt
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------- Funktionsplotter ----------

const RANGE_FIELDS = [["xMin", "x von"], ["xMax", "x bis"], ["yMin", "y von"], ["yMax", "y bis"]] as const;
const num = (s: string) => Number(s.trim().replace(",", "."));

function PlotTab() {
  const { spec: stored, setSpec, editing, host } = useCalc();
  const spec = stored ?? defaultSpec();
  const set = (s: PlotSpec) => setSpec(s);
  const fns = useMemo(() => compileAll(spec), [spec]);
  const rangeErr = validRange(spec);
  const svg = useMemo(() => (rangeErr ? null : plotSvg(spec, 480, 360, fns)), [spec, fns, rangeErr]);
  const points = useMemo(() => (rangeErr ? [] : analyze(spec, fns)), [spec, fns, rangeErr]);
  const [range, setRange] = useState<Record<string, string>>({});
  const hasFn = fns.some((f) => typeof f === "function");

  // Bereichsfelder folgen dem Zoom/Verschieben, solange nicht getippt wird
  useEffect(() => {
    setRange(Object.fromEntries(RANGE_FIELDS.map(([k]) => [k, fmtCoord(spec[k])])));
  }, [spec.xMin, spec.xMax, spec.yMin, spec.yMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchFn = (i: number, expr: string) => set({ ...spec, fns: spec.fns.map((f, j) => (j === i ? { ...f, expr } : f)) });
  const addFn = () => {
    const used = new Set(spec.fns.map((f) => f.color));
    set({ ...spec, fns: [...spec.fns, { expr: "", color: PLOT_COLORS.find((c) => !used.has(c)) ?? PLOT_COLORS[0] }] });
  };

  // Ziehen verschiebt den Ausschnitt, Mausrad/Pinch über Knöpfe zoomt
  const drag = useRef<{ x: number; y: number; s: PlotSpec; w: number; h: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, s: spec, w: r.width, h: r.height };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = ((e.clientX - d.x) / d.w) * (d.s.xMax - d.s.xMin), dy = ((e.clientY - d.y) / d.h) * (d.s.yMax - d.s.yMin);
    set({ ...d.s, xMin: d.s.xMin - dx, xMax: d.s.xMax - dx, yMin: d.s.yMin + dy, yMax: d.s.yMax + dy });
  };
  const onWheel = (e: React.WheelEvent) => set(zoomSpec(spec, e.deltaY > 0 ? 1.15 : 1 / 1.15));

  return (
    <div className="grid gap-2 p-2">
      <ul className="grid gap-1" aria-label="Funktionen">
        {spec.fns.map((f, i) => {
          const c = fns[i];
          const error = c && typeof c !== "function" ? c.error : null;
          return (
            <li key={i} className="grid gap-0.5">
              <div className="flex items-center gap-1">
                <span className="w-14 shrink-0 text-right font-mono text-sm whitespace-nowrap" style={{ color: f.color }}>{fnName(i)}(x) =</span>
                <Input aria-label={`Funktion ${fnName(i)}`} data-testid="plot-fn" spellCheck={false} autoComplete="off"
                  className="font-mono" placeholder={i === 0 ? "z. B. x^2 - 2x - 3" : ""} value={f.expr}
                  aria-invalid={!!error} onChange={(e) => patchFn(i, e.target.value)} />
                <Button variant="ghost" size="icon" aria-label={`Funktion ${fnName(i)} entfernen`} disabled={spec.fns.length === 1 && !f.expr}
                  onClick={() => set({ ...spec, fns: spec.fns.length === 1 ? [{ ...f, expr: "" }] : spec.fns.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
              {error && <p className="pl-16 text-xs text-destructive">{error}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" disabled={spec.fns.length >= MAX_FNS} onClick={addFn}><Plus /> Funktion</Button>
        <label className="ml-auto flex h-11 items-center gap-2 px-2 text-sm"><input type="checkbox" className="size-5" checked={spec.grid} onChange={(e) => set({ ...spec, grid: e.target.checked })} /> Gitter</label>
        <label className="flex h-11 items-center gap-2 px-2 text-sm"><input type="checkbox" className="size-5" checked={spec.points} onChange={(e) => set({ ...spec, points: e.target.checked })} /> Punkte</label>
      </div>

      <div className="relative">
        <div role="img" aria-label="Funktionsgraph" data-testid="plot-preview" className="aspect-[4/3] w-full cursor-grab touch-none overflow-hidden rounded-lg active:cursor-grabbing"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)} onWheel={onWheel}>
          {svg ? <img src={svgDataUrl(svg)} alt="" draggable={false} className="pointer-events-none size-full select-none" />
            : <p className="p-4 text-sm text-destructive">{rangeErr}</p>}
        </div>
        <div className="absolute right-1 bottom-1 flex gap-1">
          <Button variant="secondary" size="icon" aria-label="Hineinzoomen" onClick={() => set(zoomSpec(spec, 0.7))}><ZoomIn /></Button>
          <Button variant="secondary" size="icon" aria-label="Herauszoomen" onClick={() => set(zoomSpec(spec, 1 / 0.7))}><ZoomOut /></Button>
          <Button variant="secondary" size="icon" aria-label="y-Bereich anpassen" title="y-Bereich anpassen" disabled={!hasFn}
            onClick={() => { const y = autoY(spec, fns); if (y) set({ ...spec, ...y }); }}><Maximize2 /></Button>
          <Button variant="secondary" size="icon" aria-label="Standardbereich" title="Standardbereich"
            onClick={() => { const d = defaultSpec(); set({ ...spec, xMin: d.xMin, xMax: d.xMax, yMin: d.yMin, yMax: d.yMax }); }}><Crosshair /></Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {RANGE_FIELDS.map(([k, label]) => (
          <label key={k} className="grid gap-0.5 text-xs text-muted-foreground">{label}
            <Input inputMode="decimal" className="px-2 font-mono" value={range[k] ?? ""}
              onChange={(e) => setRange({ ...range, [k]: e.target.value })}
              onBlur={() => { const v = num(range[k] ?? ""); if (Number.isFinite(v)) set({ ...spec, [k]: v }); else setRange({ ...range, [k]: fmtCoord(spec[k]) }); }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          </label>
        ))}
      </div>

      {points.length > 0 && (
        <details open className="rounded-lg border p-2 text-sm">
          <summary className="cursor-pointer font-medium">Besondere Punkte ({points.length})</summary>
          <ul className="mt-1 grid gap-0.5" data-testid="plot-points">
            {points.map((p, i) => (
              <li key={i} className="flex gap-2 tabular-nums">
                <span className="w-28 shrink-0" style={{ color: spec.fns[p.fn].color }}>
                  {POINT_TEXT[p.kind]} {p.kind === "cross" ? `${fnName(p.fn)}∩${fnName(p.other!)}` : fnName(p.fn)}
                </span>
                <span>({fmtCoord(p.x)} | {fmtCoord(p.y)})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {host ? (
        <Button disabled={!hasFn || !svg} onClick={() => svg && host.insertPlot(spec, svg, editing)} data-testid="plot-insert">
          <FilePlus2 /> {editing ? "Graph auf dem Blatt aktualisieren" : "Als Graph aufs Blatt"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Öffne ein Blatt, um den Graphen einzufügen.</p>
      )}
    </div>
  );
}
