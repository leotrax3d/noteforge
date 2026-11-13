// Zoom-Schreibfeld (SPEC §4.3, wie GoodNotes): unten vergrößert schreiben, auf dem Blatt verkleinert einfügen.
// Ein Rahmen markiert die Zielstelle; er rückt beim Schreiben nach rechts weiter und springt am Zeilenende
// in die nächste Linie bzw. Karozeile.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CornerDownLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CanvasEngine } from "@/canvas/core/engine";
import { A4_GAP, MM, a4Size } from "@/canvas/core/layout";
import { PSTRIDE, makeStroke, uid, type Stroke } from "@/canvas/core/model";
import { PENS, drawStroke, strokePath } from "@/canvas/core/pens";
import { useTools } from "./tool-store";

const PANEL_H = 210;
/** Weiterrücken, sobald rechts dieser Anteil des Felds beschrieben ist */
const ADVANCE_AT = 0.7;
const KEEP = 0.25;
const FACTORS = [2, 3, 4, 5, 6];

/** Glättung für kleine Schrift: Mindestabstand + gleitender Mittelwert über 3 Punkte (Welt). */
export function smoothSmall(pts: number[], minDist: number): Float32Array {
  const keep: number[] = [];
  for (let i = 0; i < pts.length; i += PSTRIDE) {
    const k = keep.length;
    if (k && Math.hypot(pts[i] - keep[k - PSTRIDE], pts[i + 1] - keep[k - PSTRIDE + 1]) < minDist && i + PSTRIDE < pts.length) continue;
    for (let j = 0; j < PSTRIDE; j++) keep.push(pts[i + j]);
  }
  const out = new Float32Array(keep);
  const n = out.length / PSTRIDE;
  for (let i = 1; i < n - 1; i++) {
    for (const d of [0, 1]) out[i * PSTRIDE + d] = (keep[(i - 1) * PSTRIDE + d] + 2 * keep[i * PSTRIDE + d] + keep[(i + 1) * PSTRIDE + d]) / 4;
  }
  return out;
}

export function ZoomWriter({ engine, dark, hostRef }: { engine: CanvasEngine; dark: boolean; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const factor = useTools((s) => s.zoomFactor);
  const setZoom = useTools((s) => s.setZoom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelW, setPanelW] = useState(800);
  const setup = engine.pageSetup();
  const step = (setup.background === "blank" ? 8 : setup.bgSpacingMm) * MM;
  const fH = PANEL_H / factor, fW = panelW / factor;
  const lineAdvance = Math.max(step, Math.round((fH * 0.75) / step) * step);

  // Zeilenbereich: A4 = Seitenbreite mit Rand, endlos = 18 cm ab Startspalte
  const lineRange = useCallback((x: number, y: number) => {
    if (setup.mode === "a4") {
      const { w, h } = a4Size(setup.orientation);
      const i = Math.max(0, Math.floor(y / (h + A4_GAP)));
      void i;
      return { left: 15 * MM, right: w - 15 * MM };
    }
    return { left: x, right: x + 180 * MM };
  }, [setup.mode, setup.orientation]);

  const init = () => {
    const c = engine.screenToWorld({ x: 60, y: Math.max(200, (hostRef.current?.clientHeight ?? 600) * 0.3) });
    const y = Math.round(c.y / step) * step - fH * 0.3;
    const x = setup.mode === "a4" ? Math.max(15 * MM, c.x) : c.x;
    return { x, y, left: lineRange(x, y).left };
  };
  const frame = useRef<{ x: number; y: number; left: number }>(init());
  const live = useRef<{ id: number; pts: number[]; pressure: boolean } | null>(null);
  const dirty = useRef(true);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rahmen auf dem Blatt + Feld zeichnen (pro Frame, nur DOM/Canvas, kein React-State)
  useEffect(() => {
    let raf = 0, last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cam = engine.camera, f = frame.current;
      const el = frameRef.current;
      if (el) {
        el.style.transform = `translate(${(f.x - cam.x) * cam.s}px, ${(f.y - cam.y) * cam.s}px)`;
        el.style.width = `${fW * cam.s}px`;
        el.style.height = `${fH * cam.s}px`;
      }
      const key = `${f.x}|${f.y}|${panelW}|${factor}|${dark}`;
      if (key !== last) { last = key; dirty.current = true; }
      if (dirty.current) { dirty.current = false; draw(); }
    };
    raf = requestAnimationFrame(tick);
    const iv = window.setInterval(() => (dirty.current = true), 400); // Änderungen auf dem Blatt (Radieren …) übernehmen
    return () => { cancelAnimationFrame(raf); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, fW, fH, panelW, factor, dark]);

  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(panelW * dpr)) { c.width = Math.round(panelW * dpr); c.height = Math.round(PANEL_H * dpr); }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = dark ? "#1f2023" : "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    const f = frame.current, k = factor * dpr;
    ctx.setTransform(k, 0, 0, k, -f.x * k, -f.y * k);
    // Hilfslinien des Blatts
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.18)" : "rgba(37,99,235,0.22)";
    ctx.lineWidth = 1 / k;
    ctx.beginPath();
    for (let y = Math.ceil(f.y / step) * step; y < f.y + fH; y += step) { ctx.moveTo(f.x, y); ctx.lineTo(f.x + fW, y); }
    if (setup.background !== "lines" && setup.background !== "blank")
      for (let x = Math.ceil(f.x / step) * step; x < f.x + fW; x += step) { ctx.moveTo(x, f.y); ctx.lineTo(x, f.y + fH); }
    ctx.stroke();
    for (const s of engine.strokesIn({ x: f.x, y: f.y, w: fW, h: fH })) drawStroke(ctx, s, dark, strokePath(s));
    const l = live.current;
    if (l && l.pts.length >= PSTRIDE) drawStroke(ctx, liveStroke(l), dark);
    // Weiterrück-Marke
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.06)" : "rgba(37,99,235,0.06)";
    ctx.fillRect(panelW * ADVANCE_AT, 0, panelW * (1 - ADVANCE_AT), PANEL_H);
  };

  const liveStroke = (l: { pts: number[]; pressure: boolean }): Stroke => {
    const t = engine.toolState;
    const pen = t.tool === "pen" ? t.pen : "ballpoint";
    return makeStroke({ id: "live", z: 0, pen, color: t.color, width: t.width, opacity: t.opacity ?? PENS[pen].opacity, pressure: l.pressure, points: new Float32Array(l.pts) });
  };

  const toWorld = (e: PointerEvent | React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: frame.current.x + (e.clientX - r.left) / factor, y: frame.current.y + (e.clientY - r.top) / factor };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && !useTools.getState().fingerDraws) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const w = toWorld(e);
    live.current = { id: e.pointerId, pts: [w.x, w.y, e.pointerType === "pen" ? e.pressure || 0.5 : 0.5, 0, 0], pressure: e.pointerType === "pen" };
    (live.current as unknown as { t0: number }).t0 = e.timeStamp;
    dirty.current = true;
  };
  const onMove = (e: React.PointerEvent) => {
    const l = live.current;
    if (!l || e.pointerId !== l.id) return;
    const t0 = (l as unknown as { t0: number }).t0;
    for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const w = toWorld(ev);
      l.pts.push(w.x, w.y, ev.pointerType === "pen" ? ev.pressure || 0.5 : 0.5, 0, ev.timeStamp - t0);
    }
    dirty.current = true;
  };
  const onUp = (e: React.PointerEvent) => {
    const l = live.current;
    if (!l || e.pointerId !== l.id) return;
    live.current = null;
    const pts = smoothSmall(l.pts, 0.12);
    const s = { ...liveStroke({ ...l, pts: Array.from(pts) }), id: uid() };
    engine.addStrokes([s]);
    // Weiterrücken: rechts beschrieben → Rahmen nach rechts, am Zeilenende → nächste Zeile
    let maxX = -Infinity;
    for (let i = 0; i < pts.length; i += PSTRIDE) maxX = Math.max(maxX, pts[i]);
    const f = frame.current;
    if (maxX > f.x + fW * ADVANCE_AT) {
      const nx = maxX - fW * KEEP;
      const { right } = lineRange(f.left, f.y);
      if (nx + fW > right + fW * 0.3) newLine();
      else frame.current = { ...f, x: nx };
    }
    dirty.current = true;
  };

  const newLine = () => {
    const f = frame.current;
    frame.current = { ...f, x: f.left, y: f.y + lineAdvance };
    follow();
  };
  const shift = (dx: number) => { frame.current = { ...frame.current, x: frame.current.x + dx }; follow(); };

  /** Ansicht mitführen, wenn der Rahmen aus dem sichtbaren Bereich läuft. */
  const follow = () => {
    const host = hostRef.current;
    if (!host) return;
    const f = frame.current, cam = engine.camera;
    const sy = (f.y - cam.y) * cam.s, sx = (f.x - cam.x) * cam.s;
    const visibleH = host.clientHeight - PANEL_H - 80;
    if (sy < 0 || sy + fH * cam.s > visibleH || sx < 0 || sx + fW * cam.s > host.clientWidth)
      engine.focusOn({ x: f.x - 40 / cam.s, y: f.y - visibleH / 3 / cam.s, w: fW + 80 / cam.s, h: fH });
  };

  // Rahmen auf dem Blatt ziehen
  const onFrameDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, f: { ...frame.current } };
    const move = (ev: PointerEvent) => {
      const s = engine.camera.s;
      const x = start.f.x + (ev.clientX - start.x) / s, y = start.f.y + (ev.clientY - start.y) / s;
      frame.current = { x, y, left: setup.mode === "a4" ? lineRange(x, y).left : x };
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <>
      <div ref={frameRef} data-testid="zoom-frame" aria-label="Zielrahmen des Zoom-Schreibfelds (ziehen zum Verschieben)"
        onPointerDown={onFrameDown}
        className="absolute top-0 left-0 z-20 cursor-move touch-none rounded-sm border-2 border-[var(--subject,#2563eb)] bg-[color-mix(in_oklab,var(--subject,#2563eb)_8%,transparent)]" />
      <div ref={panelRef} role="region" aria-label="Zoom-Schreibfeld" data-testid="zoom-writer"
        data-glass="bar" data-glass-float=""
        className="absolute right-0 bottom-0 left-0 z-30 border-t bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <span className="mr-2 text-sm font-medium">Zoom-Schreibfeld</span>
          <Button variant="ghost" size="icon" aria-label="Rahmen nach links" title="Rahmen nach links" onClick={() => shift(-fW * 0.5)}><ArrowLeft /></Button>
          <Button variant="ghost" size="icon" aria-label="Rahmen nach rechts" title="Rahmen nach rechts" onClick={() => shift(fW * 0.5)}><ArrowRight /></Button>
          <Button variant="ghost" size="icon" aria-label="Neue Zeile" title="Neue Zeile" onClick={newLine}><CornerDownLeft /></Button>
          <div role="radiogroup" aria-label="Vergrößerung" className="ml-2 flex gap-0.5">
            {FACTORS.map((f) => (
              <Button key={f} role="radio" aria-checked={factor === f} variant={factor === f ? "secondary" : "ghost"}
                className={cn("h-11 min-w-11 px-2 tabular-nums", factor === f && "ring-2 ring-ring")} onClick={() => setZoom({ zoomFactor: f })}>{f}×</Button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="Zoom-Schreibfeld schließen" title="Schließen (Z)" onClick={() => setZoom({ zoomWrite: false })}><X /></Button>
        </div>
        <canvas ref={canvasRef} className="block w-full touch-none" style={{ height: PANEL_H, touchAction: "none" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { live.current = null; dirty.current = true; }} />
      </div>
    </>
  );
}
