/**
 * Palm Rejection: Solange ein Stift aktiv ist (aufgesetzt, in Reichweite/schwebend oder kürzlich
 * benutzt), werden Touch-Eingaben ignoriert. Kontakte, die einmal als Handballen gelten, bleiben es
 * bis zum Abheben – auch wenn der Stift danach wieder weg ist – und zählen nie für Gesten.
 * Gesten mit 2+ echten Fingern bleiben erlaubt (werden nicht gezeichnet).
 */
export type InputDecision = "draw" | "ignore" | "gesture";

/** Kontaktfläche (CSS-px), ab der ein Touch als Handballen gilt. */
export const PALM_CONTACT_PX = 48;
/** Große Kontaktfläche zählt nur als Handballen, wenn der Stift in dieser Zeit benutzt wurde
 *  (manche Touchscreens melden auch für Finger große Flächen – ohne Stift gibt es keinen Handballen). */
export const PALM_SIZE_WINDOW_MS = 15000;

export class PalmRejection {
  /** Wie lange nach der letzten Stiftaktivität Touch noch ignoriert wird (ms). */
  penGraceMs = 2500;
  private penDown = false;
  private lastPenActivity = -Infinity;
  private touches = new Set<number>();
  private palms = new Set<number>();
  /** Finger während der Stift-Nachlaufzeit: zeichnen nie, werden aber mit einem zweiten Finger zur Geste. */
  private pending = new Set<number>();
  private promoted: number[] = [];

  penActive(now: number, graceMs = this.penGraceMs): boolean {
    return this.penDown || now - this.lastPenActivity < graceMs;
  }

  /** Bei jedem Pointer-Event (auch Hover) aufrufen. */
  notePen(now: number, down?: boolean) {
    this.lastPenActivity = now;
    if (down !== undefined) this.penDown = down;
  }

  /** `size` = größere Kantenlänge der Kontaktfläche (PointerEvent.width/height). */
  onDown(pointerType: string, pointerId: number, now: number, size = 0, isPrimary = false): InputDecision {
    if (pointerType === "pen") {
      this.notePen(now, true);
      return "draw";
    }
    if (pointerType === "touch") {
      // Erster Finger auf dem Bildschirm: alter Zustand ist veraltet (z. B. verpasstes pointerup außerhalb des Blatts)
      if (isPrimary) { this.touches.clear(); this.palms.clear(); this.pending.clear(); }
      const bigPalm = size >= PALM_CONTACT_PX && this.penActive(now, PALM_SIZE_WINDOW_MS);
      if (this.palms.has(pointerId) || this.penDown || bigPalm || this.palms.size > 0) {
        this.palms.add(pointerId);
        return "ignore";
      }
      // Stift schwebt/war gerade aktiv: einzelner Finger zeichnet nicht, zwei Finger = Zoom/Verschieben
      if (this.penActive(now) && this.touches.size === 0) {
        this.pending.add(pointerId);
        if (this.pending.size < 2) return "ignore";
        for (const id of this.pending) this.touches.add(id);
        this.promoted = [...this.pending].filter((id) => id !== pointerId);
        this.pending.clear();
        return "gesture";
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
      this.pending.delete(pointerId);
    }
  }

  /** Laufende Finger-Kontakte nachträglich zu Handballen erklären (Stift setzt auf). */
  demoteTouches() {
    for (const id of this.touches) this.palms.add(id);
    for (const id of this.pending) this.palms.add(id);
    this.touches.clear();
    this.pending.clear();
  }

  isPending(pointerId: number) {
    return this.pending.has(pointerId);
  }

  /** Finger, die eben mit einem zweiten zur Geste wurden (einmalig abholen). */
  takePromoted(): number[] {
    const p = this.promoted;
    this.promoted = [];
    return p;
  }

  isPalm(pointerId: number) {
    return this.palms.has(pointerId);
  }

  get touchCount() {
    return this.touches.size;
  }
}
