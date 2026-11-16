// Wo ein Kontextmenü erscheint: an der Maus-/Stiftposition, im sichtbaren Bereich.
// Manche Auslöser (Menütaste, Umschalt+F10, Stift-Langdruck unter WebView2) melden clientX/clientY = 0;
// dann gilt die letzte Zeigerposition bzw. die Schreibmarke statt des linken Bildschirmrands.

export interface Pt { x: number; y: number }

let lastPointer: (Pt & { t: number }) | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => { lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { capture: true, passive: true });
}

/** Nur für Tests. */
export function setLastPointer(p: (Pt & { t: number }) | null) { lastPointer = p; }

export function clampToViewport(p: Pt, vw = window.innerWidth, vh = window.innerHeight, pad = 4): Pt {
  return { x: Math.min(Math.max(p.x, pad), Math.max(pad, vw - pad)), y: Math.min(Math.max(p.y, pad), Math.max(pad, vh - pad)) };
}

/** Viewport-Koordinaten (wie clientX/Y) für ein Kontextmenü-Ereignis. */
export function contextPoint(e: { clientX: number; clientY: number }, el?: Element | null, now = performance.now()): Pt {
  const valid = Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && !(e.clientX === 0 && e.clientY === 0);
  if (valid) return clampToViewport({ x: e.clientX, y: e.clientY });
  if (lastPointer && now - lastPointer.t < 1500) return clampToViewport(lastPointer);
  const s = typeof window !== "undefined" ? window.getSelection() : null;
  if (s?.rangeCount && el?.contains(s.anchorNode)) {
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (r.width || r.height || r.left || r.top) return clampToViewport({ x: r.left, y: r.bottom });
  }
  const b = el?.getBoundingClientRect();
  return clampToViewport(b ? { x: b.left + 8, y: b.top + 8 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
}
