/**
 * Palm Rejection: Solange ein Stift aktiv ist (aufgesetzt, in Reichweite/schwebend oder kürzlich
 * benutzt), werden Touch-Eingaben ignoriert. Kontakte, die einmal als Handballen gelten, bleiben es
 * bis zum Abheben – auch wenn der Stift danach wieder weg ist – und zählen nie für Gesten.
 * Gesten mit 2+ echten Fingern bleiben erlaubt (werden nicht gezeichnet).
 */
export type InputDecision = "draw" | "ignore" | "gesture";

/** Kontaktfläche (CSS-px), ab der ein Touch als Handballen gilt. */
export const PALM_CONTACT_PX = 32;

export class PalmRejection {
  /** Wie lange nach der letzten Stiftaktivität Touch noch ignoriert wird (ms). */
  penGraceMs = 2500;
  private penDown = false;
  private lastPenActivity = -Infinity;
  private touches = new Set<number>();
  private palms = new Set<number>();

  penActive(now: number): boolean {
    return this.penDown || now - this.lastPenActivity < this.penGraceMs;
  }

  /** Bei jedem Pointer-Event (auch Hover) aufrufen. */
  notePen(now: number, down?: boolean) {
    this.lastPenActivity = now;
    if (down !== undefined) this.penDown = down;
  }

  /** `size` = größere Kantenlänge der Kontaktfläche (PointerEvent.width/height). */
  onDown(pointerType: string, pointerId: number, now: number, size = 0): InputDecision {
    if (pointerType === "pen") {
      this.notePen(now, true);
      return "draw";
    }
    if (pointerType === "touch") {
      if (this.palms.has(pointerId) || this.penActive(now) || size >= PALM_CONTACT_PX || this.palms.size > 0) {
        this.palms.add(pointerId);
        return "ignore";
      }
      this.touches.add(pointerId);
      if (this.touches.size >= 2) return "gesture";
      return "draw";
    }
    return "draw"; // Maus
  }

  onUp(pointerType: string, pointerId: number, now: number) {
    if (pointerType === "pen") this.notePen(now, false);
    else if (pointerType === "touch") {
      this.touches.delete(pointerId);
      this.palms.delete(pointerId);
    }
  }

  /** Laufende Finger-Kontakte nachträglich zu Handballen erklären (Stift setzt auf). */
  demoteTouches() {
    for (const id of this.touches) this.palms.add(id);
    this.touches.clear();
  }

  isPalm(pointerId: number) {
    return this.palms.has(pointerId);
  }

  get touchCount() {
    return this.touches.size;
  }
}
