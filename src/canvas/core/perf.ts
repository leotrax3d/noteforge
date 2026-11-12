/**
 * Leistungs-Profiling der Canvas-Engine (Phase 8). Nur aktiv, wenn eingeschaltet –
 * sonst kostet es im Hot Path genau eine Null-Prüfung. Keine Allokationen pro Frame.
 */
export interface PerfSample {
  fps: number;
  /** Rechenzeit pro Frame (ms) */
  frameAvg: number;
  frameMax: number;
  /** Davon Basisebene (Kacheln) */
  baseAvg: number;
  /** neu gerenderte Kacheln pro Sekunde */
  tilesPerSec: number;
  /** Stift-Ereignis → gezeichneter Frame (ms) */
  latencyAvg: number;
  latencyMax: number;
  strokes: number;
  objects: number;
  /** Anteil langer Frames (> 16,7 ms) in Prozent */
  jank: number;
}

export class PerfMeter {
  private start = 0;
  private frames = 0;
  private work = 0;
  private workMax = 0;
  private base = 0;
  private tiles = 0;
  private lat = 0;
  private latN = 0;
  private latMax = 0;
  private long = 0;
  private lastFrame = 0;
  private shownLat = 0;
  private shownLatMax = 0;
  /** Zeitstempel des ältesten noch nicht gezeichneten Eingabe-Ereignisses (−1 = keines) */
  inputTs = -1;

  constructor(private emit: (s: PerfSample) => void, private counts: () => { strokes: number; objects: number }, private windowMs = 500) {}

  input(ts: number) {
    if (this.inputTs < 0) this.inputTs = ts;
  }

  tile() {
    this.tiles++;
  }

  /** Nach einem Frame: Gesamtarbeit und Anteil Basisebene in ms; `drewInput`: aktive Ebene enthielt Eingaben. */
  frame(now: number, workMs: number, baseMs: number, drewInput: boolean) {
    if (!this.start) this.start = now;
    this.frames++;
    this.work += workMs;
    this.base += baseMs;
    if (workMs > this.workMax) this.workMax = workMs;
    if (this.lastFrame && now - this.lastFrame > 1000 / 60 + 4) this.long++;
    this.lastFrame = now;
    if (drewInput && this.inputTs >= 0) {
      const l = performance.now() - this.inputTs;
      if (l >= 0 && l < 1000) {
        this.lat += l;
        this.latN++;
        if (l > this.latMax) this.latMax = l;
      }
      this.inputTs = -1;
    }
    const el = now - this.start;
    if (el < this.windowMs) return;
    const c = this.counts();
    // Latenz bleibt bis zum nächsten Strich stehen (sonst nach dem Absetzen sofort 0)
    if (this.latN) {
      this.shownLat = this.lat / this.latN;
      this.shownLatMax = this.latMax;
    }
    this.emit({
      fps: (this.frames * 1000) / el,
      frameAvg: this.work / this.frames,
      frameMax: this.workMax,
      baseAvg: this.base / this.frames,
      tilesPerSec: (this.tiles * 1000) / el,
      latencyAvg: this.shownLat,
      latencyMax: this.shownLatMax,
      strokes: c.strokes,
      objects: c.objects,
      jank: (this.long * 100) / this.frames,
    });
    this.start = now;
    this.frames = this.work = this.workMax = this.base = this.tiles = this.lat = this.latN = this.latMax = this.long = 0;
  }
}
