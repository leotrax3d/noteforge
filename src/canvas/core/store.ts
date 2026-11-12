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
export class StrokeStore {
  private map = new Map<string, Stroke>();
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
    }
    return this.sorted;
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

  /** Ausstehende Änderungen für das Autospeichern abholen. */
  takePending(): PendingBatch {
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
    this.pending.clear();
    return { upserts, objects, deletes };
  }

  /** Nach fehlgeschlagenem Speichern wieder vormerken. */
  restorePending(p: PendingBatch) {
    for (const s of p.upserts) if (!this.pending.has(s.id)) this.pending.set(s.id, true);
    for (const o of p.objects) if (!this.pending.has(o.id)) this.pending.set(o.id, true);
    for (const id of p.deletes) if (!this.pending.has(id)) this.pending.set(id, false);
  }
}
