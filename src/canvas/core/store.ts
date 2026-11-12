import type { Stroke } from "./model";
import type { CanvasObj } from "./objects";

/** Änderung als umkehrbarer Befehl: erst `remove`, dann `add` (gleiche ID = ersetzen). */
export interface Change {
  add: Stroke[];
  remove: Stroke[];
  /** Objekte (Text, Bild, Tabelle) analog. */
  addObj?: CanvasObj[];
  removeObj?: CanvasObj[];
}

export const invert = (c: Change): Change => ({ add: c.remove, remove: c.add, addObj: c.removeObj, removeObj: c.addObj });
export const isEmpty = (c: Change) =>
  c.add.length === 0 && c.remove.length === 0 && !c.addObj?.length && !c.removeObj?.length;

export interface PendingBatch {
  upserts: Stroke[];
  objects: CanvasObj[];
  deletes: string[];
}

/** Strichdokument eines Blatts mit Undo/Redo-Stack und Speicher-Tracking. */
/** Kantenlänge einer Zelle des Raster-Index (Welteinheiten). */
const CELL = 512;
/** Striche über mehr Zellen landen in einer immer geprüften Liste. */
const MAX_CELLS = 64;

export class StrokeStore {
  private map = new Map<string, Stroke>();
  /** Raster-Index über `all()`: Zelle → aufsteigende Indizes in `sorted` */
  private grid: Map<number, number[]> | null = null;
  private big: number[] = [];
  private seen = new Uint32Array(0);
  private stamp = 0;
  private objMap = new Map<string, CanvasObj>();
  private sorted: Stroke[] | null = [];
  private sortedObj: CanvasObj[] | null = [];
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  /** id → true = speichern, false = löschen */
  private pending = new Map<string, boolean>();
  private zNext = 0;
  onApply?: (c: Change) => void;
  /** Nach jeder Änderung an Undo/Redo-Stack. */
  onHistory?: () => void;

  load(strokes: Stroke[], objects: CanvasObj[] = []) {
    this.map.clear();
    this.objMap.clear();
    for (const s of strokes) {
      this.map.set(s.id, s);
      this.zNext = Math.max(this.zNext, s.z + 1);
    }
    for (const o of objects) {
      this.objMap.set(o.id, o);
      this.zNext = Math.max(this.zNext, o.z + 1);
    }
    this.sorted = null;
    this.sortedObj = null;
  }

  getObj(id: string) {
    return this.objMap.get(id);
  }

  /** Objekte nach z sortiert. */
  objects(): CanvasObj[] {
    if (!this.sortedObj) this.sortedObj = [...this.objMap.values()].sort((a, b) => a.z - b.z);
    return this.sortedObj;
  }

  nextZ() {
    return this.zNext++;
  }

  get(id: string) {
    return this.map.get(id);
  }

  get size() {
    return this.map.size;
  }

  /** Nach z sortiert; Textmarker zuerst (liegen unter der Schrift). */
  all(): Stroke[] {
    if (!this.sorted) {
      this.sorted = [...this.map.values()].sort((a, b) => {
        const ha = a.pen === "highlighter" ? 0 : 1, hb = b.pen === "highlighter" ? 0 : 1;
        return ha - hb || a.z - b.z;
      });
      this.grid = null;
    }
    return this.sorted;
  }

  private buildGrid(all: Stroke[]) {
    const g = new Map<number, number[]>();
    this.big = [];
    for (let i = 0; i < all.length; i++) {
      const b = all[i].bbox;
      const x0 = Math.floor(b.x / CELL), y0 = Math.floor(b.y / CELL);
      const x1 = Math.floor((b.x + b.w) / CELL), y1 = Math.floor((b.y + b.h) / CELL);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
        this.big.push(i);
        continue;
      }
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const k = key(x, y);
          const l = g.get(k);
          if (l) l.push(i);
          else g.set(k, [i]);
        }
    }
    this.grid = g;
    if (this.seen.length < all.length) this.seen = new Uint32Array(all.length * 2);
  }

  /**
   * Striche, deren Rahmen das Rechteck schneiden könnte – in derselben Reihenfolge wie `all()`.
   * Für das Kachel-Rendering: ohne Index wäre jede Kachel O(alle Striche).
   */
  inRect(r: { x: number; y: number; w: number; h: number }, out: Stroke[] = []): Stroke[] {
    const all = this.all();
    if (!this.grid) this.buildGrid(all);
    const g = this.grid!;
    out.length = 0;
    const idx: number[] = [];
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const st = this.stamp, seen = this.seen;
    const take = (l: number[]) => {
      for (const i of l) if (seen[i] !== st) { seen[i] = st; idx.push(i); }
    };
    take(this.big);
    const x0 = Math.floor(r.x / CELL), y0 = Math.floor(r.y / CELL);
    const x1 = Math.floor((r.x + r.w) / CELL), y1 = Math.floor((r.y + r.h) / CELL);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const l = g.get(key(x, y));
        if (l) take(l);
      }
    idx.sort((a, b) => a - b);
    for (const i of idx) out.push(all[i]);
    return out;
  }

  /** Änderung anwenden ohne Verlauf (z. B. live beim Radieren). */
  applyRaw(c: Change) {
    for (const s of c.remove) {
      this.map.delete(s.id);
      this.pending.set(s.id, false);
    }
    for (const s of c.add) {
      this.map.set(s.id, s);
      this.pending.set(s.id, true);
      if (s.z >= this.zNext) this.zNext = s.z + 1;
    }
    if (c.removeObj || c.addObj) {
      for (const o of c.removeObj ?? []) {
        this.objMap.delete(o.id);
        this.pending.set(o.id, false);
      }
      for (const o of c.addObj ?? []) {
        this.objMap.set(o.id, o);
        this.pending.set(o.id, true);
        if (o.z >= this.zNext) this.zNext = o.z + 1;
      }
      this.sortedObj = null;
    }
    this.sorted = null;
    this.onApply?.(c);
  }

  /** Bereits angewendete Änderung in den Verlauf legen. */
  record(c: Change) {
    if (isEmpty(c)) return;
    this.undoStack.push(c);
    this.redoStack.length = 0;
    this.onHistory?.();
  }

  commit(c: Change) {
    if (isEmpty(c)) return;
    this.applyRaw(c);
    this.record(c);
  }

  undo(): Change | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    this.applyRaw(invert(c));
    this.redoStack.push(c);
    this.onHistory?.();
    return c;
  }

  redo(): Change | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    this.applyRaw(c);
    this.undoStack.push(c);
    this.onHistory?.();
    return c;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  get hasPending() {
    return this.pending.size > 0;
  }

  /** Ausstehende Änderungen ansehen, ohne sie abzuholen (Write-Ahead-Journal). */
  peekPending(): PendingBatch {
    const b = this.collectPending();
    return b;
  }

  /** Ausstehende Änderungen für das Autospeichern abholen. */
  takePending(): PendingBatch {
    const b = this.collectPending();
    this.pending.clear();
    return b;
  }

  private collectPending(): PendingBatch {
    const upserts: Stroke[] = [];
    const objects: CanvasObj[] = [];
    const deletes: string[] = [];
    for (const [id, save] of this.pending) {
      const s = this.map.get(id);
      const o = s ? undefined : this.objMap.get(id);
      if (save && s) upserts.push(s);
      else if (save && o) objects.push(o);
      else if (!s && !o) deletes.push(id);
    }
    return { upserts, objects, deletes };
  }

  /** Nach fehlgeschlagenem Speichern wieder vormerken. */
  restorePending(p: PendingBatch) {
    for (const s of p.upserts) if (!this.pending.has(s.id)) this.pending.set(s.id, true);
    for (const o of p.objects) if (!this.pending.has(o.id)) this.pending.set(o.id, true);
    for (const id of p.deletes) if (!this.pending.has(id)) this.pending.set(id, false);
  }
}

/** Zellschlüssel; |x|,|y| < 2^20 Zellen (≈ 500 Mio. Welteinheiten) reichen für jedes Blatt. */
const key = (x: number, y: number) => (x + 0x100000) * 0x200000 + (y + 0x100000);
