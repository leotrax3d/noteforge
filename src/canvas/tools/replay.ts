// Ink-Wiedergabe (SPEC §5): Striche in Entstehungsreihenfolge mit ihrer echten Schreibdauer.
import { PSTRIDE, type Stroke } from "../core/model";

/** Pause zwischen zwei Strichen (ms) – echte Pausen sind nicht gespeichert. */
export const GAP_MS = 220;
const MIN_MS = 120;
const MAX_MS = 6000;

export interface Timeline {
  strokes: Stroke[];
  start: number[];
  dur: number[];
  total: number;
}

export function buildTimeline(all: readonly Stroke[]): Timeline {
  const strokes = [...all].sort((a, b) => a.z - b.z);
  const start: number[] = [], dur: number[] = [];
  let t = 0;
  for (const s of strokes) {
    const last = s.points.length >= PSTRIDE ? s.points[s.points.length - 1] : 0;
    const d = Math.min(MAX_MS, Math.max(MIN_MS, Number.isFinite(last) ? last : 0));
    start.push(t);
    dur.push(d);
    t += d + GAP_MS;
  }
  return { strokes, start, dur, total: strokes.length ? t - GAP_MS : 0 };
}

/**
 * Zustand zum Zeitpunkt `t`: Anzahl fertiger Striche und ggf. der gerade
 * entstehende Strich mit der Zahl schon geschriebener Punkte.
 */
export function stateAt(tl: Timeline, t: number): { done: number; partial: { index: number; count: number } | null } {
  // Binärsuche: letzter Strich mit start <= t
  let lo = 0, hi = tl.strokes.length - 1, i = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (tl.start[m] <= t) { i = m; lo = m + 1; } else hi = m - 1;
  }
  if (i < 0) return { done: 0, partial: null };
  const local = t - tl.start[i];
  if (local >= tl.dur[i]) return { done: i + 1, partial: null };
  const s = tl.strokes[i];
  const n = s.points.length / PSTRIDE;
  const tEnd = s.points[(n - 1) * PSTRIDE + 4] || 0;
  // Zeitstempel skalieren, falls die Dauer begrenzt wurde (oder fehlt)
  const k = tEnd > 0 ? tEnd / tl.dur[i] : 0;
  let count = 0;
  if (k > 0) {
    const tt = local * k;
    while (count < n && s.points[count * PSTRIDE + 4] <= tt) count++;
  } else count = Math.ceil((local / tl.dur[i]) * n);
  return { done: i, partial: { index: i, count: Math.max(1, Math.min(n, count)) } };
}

export function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
