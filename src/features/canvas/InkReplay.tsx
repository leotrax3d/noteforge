import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanvasEngine } from "@/canvas/core/engine";
import { drawImageObj } from "@/canvas/core/engine";
import { PALETTES, drawBackground } from "@/canvas/core/background";
import type { ImageObj } from "@/canvas/core/objects";
import { buildPath, drawStroke, strokePath, toFreehand } from "@/canvas/core/pens";
import { buildTimeline, fmtTime, stateAt } from "@/canvas/tools/replay";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 2, 4, 8];

/** Ink-Wiedergabe als Overlay über der Zeichenfläche (Ansicht bleibt wie beim Öffnen). */
export function InkReplay({ engine, onClose }: { engine: CanvasEngine; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tl = useMemo(() => buildTimeline(engine.store.all()), [engine]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(tl.total > 0);
  const [speed, setSpeed] = useState(2);
  const state = useRef({ t: 0, last: 0, done: -1, layer: null as HTMLCanvasElement | null });

  // Zeichnen
  const paint = (time: number) => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      state.current.done = -1;
    }
    const s = engine.zoom, o = engine.worldToScreen({ x: 0, y: 0 });
    const m = [s * dpr, 0, 0, s * dpr, o.x * dpr, o.y * dpr] as const;
    const tl0 = engine.screenToWorld({ x: 0, y: 0 }), br = engine.screenToWorld({ x: W, y: H });
    const view = { x: tl0.x, y: tl0.y, w: br.x - tl0.x, h: br.y - tl0.y };
    const { setup, pageCount, dark } = engine.pageInfo;
    const st = stateAt(tl, time);

    // Fertige Striche auf eigener Ebene (nur neu, wenn sich die Anzahl ändert)
    const S = state.current;
    if (!S.layer) S.layer = document.createElement("canvas");
    const L = S.layer;
    if (S.done !== st.done || L.width !== c.width || L.height !== c.height) {
      const from = S.done >= 0 && st.done > S.done && L.width === c.width && L.height === c.height ? S.done : 0;
      if (from === 0) {
        L.width = c.width;
        L.height = c.height;
      }
      const lx = L.getContext("2d")!;
      lx.setTransform(...m);
      if (from === 0) {
        drawBackground(lx, view, s * dpr, setup, dark ? PALETTES.dark : PALETTES.light, pageCount);
        for (const ob of engine.store.objects()) if (ob.kind === "image") drawImageObj(lx, ob as ImageObj, imageOf(ob as ImageObj));
      }
      for (let i = from; i < st.done; i++) drawStroke(lx, tl.strokes[i], dark, strokePath(tl.strokes[i]));
      S.done = st.done;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(L, 0, 0);
    if (st.partial) {
      const sk = tl.strokes[st.partial.index];
      ctx.setTransform(...m);
      const path = buildPath(sk.pen, sk.width, sk.pressure, toFreehand(sk.points, st.partial.count, sk.pen === "ballpoint"), false);
      drawStroke(ctx, sk, dark, path);
      // Stiftspitze
      const p = (st.partial.count - 1) * 5;
      ctx.beginPath();
      ctx.arc(sk.points[p], sk.points[p + 1], 3 / s, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(37,99,235,0.8)";
      ctx.fill();
    }
  };

  const images = useRef(new Map<string, HTMLImageElement>());
  const imageOf = (o: ImageObj) => {
    let img = images.current.get(o.data.src);
    if (!img) {
      img = new Image();
      img.src = o.data.src;
      img.onload = () => {
        state.current.done = -1;
        paint(state.current.t);
      };
      images.current.set(o.data.src, img);
    }
    return img;
  };

  useEffect(() => {
    state.current.t = t;
    if (!playing) paint(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, playing]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    state.current.last = performance.now();
    const tick = (now: number) => {
      const S = state.current;
      S.t = Math.min(tl.total, S.t + (now - S.last) * speed);
      S.last = now;
      paint(S.t);
      setT(S.t);
      if (S.t >= tl.total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, tl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const restart = () => {
    state.current.t = 0;
    state.current.done = -1;
    setT(0);
    setPlaying(true);
  };

  return (
    <div className="absolute inset-0 z-40" data-testid="ink-replay" role="region" aria-label="Ink-Wiedergabe">
      <canvas ref={ref} className="absolute inset-0 size-full touch-none" />
      <div className="absolute bottom-4 left-1/2 flex w-[min(640px,calc(100%-24px))] -translate-x-1/2 items-center gap-1 rounded-2xl border bg-card/95 p-1.5 shadow-xl backdrop-blur">
        {tl.total === 0 ? (
          <span className="flex-1 px-3 text-sm text-muted-foreground">Auf diesem Blatt gibt es noch keine Handschrift.</span>
        ) : (
          <>
            <Button variant="ghost" size="icon" aria-label={playing ? "Pause" : "Abspielen"} onClick={() => (t >= tl.total ? restart() : setPlaying((p) => !p))}>
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Von vorn" onClick={restart}><RotateCcw /></Button>
            <input type="range" aria-label="Zeitpunkt" min={0} max={tl.total} step={10} value={t}
              onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
              className="h-11 min-w-0 flex-1 accent-[var(--subject,#2563eb)]" />
            <span className="w-24 text-center text-xs text-muted-foreground tabular-nums">{fmtTime(t)} / {fmtTime(tl.total)}</span>
            <div role="radiogroup" aria-label="Geschwindigkeit" className="flex">
              {SPEEDS.map((v) => (
                <button key={v} type="button" role="radio" aria-checked={speed === v} onClick={() => setSpeed(v)}
                  className={cn("h-11 min-w-11 rounded-md px-1 text-sm tabular-nums", speed === v ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                  {v}×
                </button>
              ))}
            </div>
          </>
        )}
        <Button variant="ghost" size="icon" aria-label="Wiedergabe beenden" onClick={onClose}><X /></Button>
      </div>
    </div>
  );
}
