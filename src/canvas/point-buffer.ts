/** Wachsender Float32-Puffer für Strichpunkte (x, y, pressure) ohne Allokation pro Event. */
export const STRIDE = 3;

export class PointBuffer {
  data: Float32Array;
  length = 0; // Anzahl Punkte

  constructor(capacity = 1024) {
    this.data = new Float32Array(capacity * STRIDE);
  }

  push(x: number, y: number, p: number) {
    const i = this.length * STRIDE;
    if (i + STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[i] = x;
    this.data[i + 1] = y;
    this.data[i + 2] = p;
    this.length++;
  }

  clear() {
    this.length = 0;
  }

  /** Kopie in Arrays für perfect-freehand (plus optionale Vorhersagepunkte). */
  toPoints(extra?: PointBuffer): number[][] {
    const n = this.length + (extra ? extra.length : 0);
    const out = new Array<number[]>(n);
    const d = this.data;
    for (let k = 0; k < this.length; k++) {
      const i = k * STRIDE;
      out[k] = [d[i], d[i + 1], d[i + 2]];
    }
    if (extra) {
      const e = extra.data;
      for (let k = 0; k < extra.length; k++) {
        const i = k * STRIDE;
        out[this.length + k] = [e[i], e[i + 1], e[i + 2]];
      }
    }
    return out;
  }

  /** Feste Kopie für gespeicherte Striche. */
  snapshot(): Float32Array {
    return this.data.slice(0, this.length * STRIDE);
  }
}
