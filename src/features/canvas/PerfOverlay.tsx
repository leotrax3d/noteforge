import { useEffect, useRef } from "react";
import type { CanvasEngine } from "@/canvas/core/engine";
import type { PerfSample } from "@/canvas/core/perf";

const f = (n: number, d = 1) => n.toFixed(d).replace(".", ",");

/** Leistungsanzeige (Strg+Umschalt+P). Schreibt direkt ins DOM – kein React-Render pro Messung. */
export function PerfOverlay({ engine }: { engine: CanvasEngine | null }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!engine) return;
    engine.setProfiling((s: PerfSample) => {
      const el = ref.current;
      if (!el) return;
      el.textContent =
        `${f(s.fps, 0)} FPS · Frame ${f(s.frameAvg, 2)} ms (max ${f(s.frameMax)})\n` +
        `Kacheln ${f(s.baseAvg, 2)} ms · ${f(s.tilesPerSec, 0)}/s neu\n` +
        `Stift-Latenz ${f(s.latencyAvg)} ms (max ${f(s.latencyMax)})\n` +
        `${s.strokes} Striche · ${s.objects} Objekte · Ruckler ${f(s.jank, 0)} %`;
      el.dataset.fps = String(Math.round(s.fps));
      el.dataset.frame = s.frameAvg.toFixed(3);
      el.dataset.frameMax = s.frameMax.toFixed(3);
      el.dataset.latency = s.latencyAvg.toFixed(2);
    });
    return () => engine.setProfiling(null);
  }, [engine]);
  return (
    <pre ref={ref} data-testid="perf-overlay" aria-live="off"
      className="pointer-events-none absolute bottom-3 left-3 z-30 rounded-md bg-black/75 px-2 py-1 font-mono text-[11px] leading-4 text-emerald-300">
      Messung läuft …
    </pre>
  );
}
