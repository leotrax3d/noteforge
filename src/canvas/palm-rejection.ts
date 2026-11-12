/**
 * Palm Rejection: Solange ein Stift aktiv ist (aufgesetzt oder kürzlich
 * benutzt/schwebend), werden Ein-Finger-Touch-Eingaben ignoriert.
 * Gesten mit 2+ Fingern bleiben erlaubt (werden nicht gezeichnet).
 */
export type InputDecision = "draw" | "ignore" | "gesture";

export class PalmRejection {
  /** Wie lange nach der letzten Stiftaktivität Touch noch ignoriert wird (ms). */
  penGraceMs = 1000;
  private penDown = false;
  private lastPenActivity = -Infinity;
  private touches = new Set<number>();

  penActive(now: number): boolean {
    return this.penDown || now - this.lastPenActivity < this.penGraceMs;
  }

  /** Bei jedem Pointer-Event (auch Hover) aufrufen. */
  notePen(now: number, down?: boolean) {
    this.lastPenActivity = now;
    if (down !== undefined) this.penDown = down;
  }

  onDown(pointerType: string, pointerId: number, now: number): InputDecision {
    if (pointerType === "pen") {
      this.notePen(now, true);
      return "draw";
    }
    if (pointerType === "touch") {
      this.touches.add(pointerId);
      if (this.touches.size >= 2) return "gesture";
      return this.penActive(now) ? "ignore" : "draw";
    }
    return "draw"; // Maus
  }

  onUp(pointerType: string, pointerId: number, now: number) {
    if (pointerType === "pen") this.notePen(now, false);
    else if (pointerType === "touch") this.touches.delete(pointerId);
  }

  get touchCount() {
    return this.touches.size;
  }
}
