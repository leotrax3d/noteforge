/** Sammelt FPS und Eingabelatenz (Event-Zeitstempel → Frame) über ein Fenster. */
export class FrameStats {
  private frames = 0;
  private windowStart = 0;
  private latSum = 0;
  private latCount = 0;
  private latMax = 0;
  fps = 0;
  latencyAvg = 0;
  latencyMax = 0;

  constructor(private windowMs = 500) {}

  /** Pro gerendertem Frame. Gibt true zurück, wenn neue Werte vorliegen. */
  frame(now: number): boolean {
    if (this.windowStart === 0) {
      this.windowStart = now;
      return false;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return false;
    this.fps = (this.frames * 1000) / elapsed;
    this.latencyAvg = this.latCount ? this.latSum / this.latCount : 0;
    this.latencyMax = this.latMax;
    this.frames = 0;
    this.latSum = 0;
    this.latCount = 0;
    this.latMax = 0;
    this.windowStart = now;
    return true;
  }

  latency(ms: number) {
    if (ms < 0 || !Number.isFinite(ms)) return;
    this.latSum += ms;
    this.latCount++;
    if (ms > this.latMax) this.latMax = ms;
  }
}
