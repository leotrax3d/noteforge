// Eingabe-Filter für saubere Striche auch bei kleiner Schrift (siehe docs/analysis-pen-artifacts.md).
import { PSTRIDE } from "./model";

/** Mindestabstand zweier Punkte in Bildschirmpixeln (wird über den Zoom in Welt umgerechnet). */
export const MIN_DIST_PX = 0.3;
/** Fenster des gleitenden Druck-Mittelwerts. */
export const PRESSURE_WINDOW = 4;
/** So viele Punkte am Anfang/Ende werden gegen Druckspitzen abgesichert. */
const EDGE = 3;

/** Weltabstand, unter dem ein neuer Punkt nur den Druck des letzten aktualisiert. */
export const minDistWorld = (camScale: number) => MIN_DIST_PX / Math.max(1e-3, camScale);

/**
 * Gleitender Mittelwert über den Rohdruck. Hält einen kleinen Ringpuffer, keine Allokation pro Event.
 */
export class PressureSmoother {
  private buf = new Float32Array(PRESSURE_WINDOW);
  private n = 0;
  private i = 0;
  reset() {
    this.n = 0;
    this.i = 0;
  }
  push(p: number): number {
    this.buf[this.i] = p;
    this.i = (this.i + 1) % PRESSURE_WINDOW;
    if (this.n < PRESSURE_WINDOW) this.n++;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.buf[k];
    return s / this.n;
  }
}

/**
 * Druckspitzen am Strichanfang und -ende abfangen (in place):
 * Die ersten/letzten Punkte dürfen nicht stark vom Druck im Strichinneren abweichen.
 */
export function clampPressureEdges(d: Float32Array, n: number) {
  if (n < EDGE * 2 + 1) {
    if (n < 2) return;
    let s = 0;
    for (let k = 0; k < n; k++) s += d[k * PSTRIDE + 2];
    const m = s / n;
    for (let k = 0; k < n; k++) {
      const j = k * PSTRIDE + 2;
      d[j] = Math.min(Math.max(d[j], m * 0.6), m * 1.4);
    }
    return;
  }
  const ref = (from: number) => {
    let s = 0;
    for (let k = from; k < from + EDGE; k++) s += d[k * PSTRIDE + 2];
    return s / EDGE;
  };
  const head = ref(EDGE), tail = ref(n - 2 * EDGE);
  for (let k = 0; k < EDGE; k++) {
    const a = k * PSTRIDE + 2, b = (n - 1 - k) * PSTRIDE + 2;
    d[a] = Math.min(Math.max(d[a], head * 0.6), head * 1.3);
    d[b] = Math.min(Math.max(d[b], tail * 0.6), tail * 1.3);
  }
}

/** Länge des Strichs in Welteinheiten. */
export function pathLength(d: Float32Array, n: number) {
  let len = 0;
  for (let k = 1; k < n; k++) {
    const i = k * PSTRIDE, j = i - PSTRIDE;
    len += Math.hypot(d[i] - d[j], d[i + 1] - d[j + 1]);
  }
  return len;
}

/** Sehr kurzer Strich (i-Punkt, Komma) → als Punkt/Kapsel zeichnen statt Polygon. */
export const isDot = (d: Float32Array, n: number, width: number) => n < 3 || pathLength(d, n) < width * 0.75;

/** Punkt oder Kapsel (abgerundete Linie zwischen erstem und letztem Punkt). */
export function dotPath(d: Float32Array, n: number, width: number, pressure: boolean, thinning: number): Path2D {
  let p = 0;
  for (let k = 0; k < n; k++) p += d[k * PSTRIDE + 2];
  p = n ? p / n : 0.5;
  const r = Math.max(0.35, (width / 2) * (pressure ? 1 - thinning * (0.5 - p) : 1));
  const x0 = d[0], y0 = d[1];
  const last = (Math.max(1, n) - 1) * PSTRIDE;
  const x1 = d[last], y1 = d[last + 1];
  const path = new Path2D();
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    path.arc(x0, y0, r, 0, Math.PI * 2);
    return path;
  }
  const a = Math.atan2(dy, dx);
  path.arc(x0, y0, r, a + Math.PI / 2, a - Math.PI / 2);
  path.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2);
  path.closePath();
  return path;
}

/** perfect-freehand-Parameter an die Strichbreite anpassen: dünne Stifte weniger ausdünnen, stärker glätten. */
export function tuneForWidth<T extends { thinning?: number; smoothing?: number; streamline?: number }>(o: T, width: number): T {
  const small = Math.min(1, width / 4); // < 4 Welteinheiten gilt als kleine Schrift
  return {
    ...o,
    thinning: (o.thinning ?? 0.5) * (0.45 + 0.55 * small),
    smoothing: Math.max(o.smoothing ?? 0.5, 0.62 - 0.12 * small),
    // Positionsglättung macht der 1€-Filter in der Engine; hier nur noch wenig, sonst werden Schleifen rund gezogen
    streamline: Math.min(o.streamline ?? 0.5, 0.1 + 0.08 * small),
  };
}

/**
 * 1€-Filter (Casiez et al. 2012) für Stiftpositionen in Bildschirmpixeln:
 * langsam → starke Glättung (kein Zittern), schnell → kaum Glättung (keine Verzögerung,
 * Schleifen und Ecken der Schreibschrift bleiben scharf). Keine Allokation pro Punkt.
 */
export class OneEuro {
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private t = -1;
  constructor(public minCutoff = 5, public beta = 0.015, public dCutoff = 1.2) {}
  reset() {
    this.t = -1;
  }
  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  /** Filtert (x, y) zum Zeitpunkt `tMs`; Ergebnis in `out`. */
  push(x: number, y: number, tMs: number, out: { x: number; y: number }) {
    if (this.t < 0) {
      this.x = x; this.y = y; this.dx = 0; this.dy = 0; this.t = tMs;
      out.x = x; out.y = y;
      return;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx += ad * ((x - this.x) / dt - this.dx);
    this.dy += ad * ((y - this.y) / dt - this.dy);
    const speed = Math.hypot(this.dx, this.dy);
    const a = OneEuro.alpha(this.minCutoff + this.beta * speed, dt);
    this.x += a * (x - this.x);
    this.y += a * (y - this.y);
    out.x = this.x; out.y = this.y;
  }
}
