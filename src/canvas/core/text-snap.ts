// Text wie in OneNote: Textcontainer an Linien/Raster einrasten, Schriftgröße folgt dem Linienabstand.
import { A4_GAP, MM, a4Size, type PageSetup } from "./layout";
import type { Vec } from "./geometry";

export interface FontMetrics {
  /** Oberlänge/Unterlänge als Anteil der Schriftgröße */
  ascent: number;
  descent: number;
}

/** Typische Metrik der UI-Schrift (Segoe UI); wird zur Laufzeit gemessen, wenn möglich. */
export const DEFAULT_METRICS: FontMetrics = { ascent: 1.07, descent: 0.25 };

export interface TextPlacement {
  x: number;
  /** Oberkante des Containers */
  y: number;
  /** Schriftgröße/Zeilenhöhe in Welteinheiten; fehlt = Standard (kein Raster) */
  size?: number;
  lineHeight?: number;
  /** Innenabstand links (0 bei Raster, damit Text auf der Karolinie beginnt) */
  padX?: number;
}

/** Schriftgröße relativ zum Linienabstand */
export const FONT_RATIO = 0.62;

function origin(setup: PageSetup, w: Vec): Vec {
  if (setup.mode !== "a4") return { x: 0, y: 0 };
  const { h } = a4Size(setup.orientation);
  const i = Math.max(0, Math.floor(w.y / (h + A4_GAP)));
  return { x: 0, y: i * (h + A4_GAP) };
}

/**
 * Wo ein neuer Textcontainer für einen Tipp bei `w` entsteht.
 * Liniert: Grundlinie auf der nächsten Linie. Kariert/punktiert: Grundlinie auf der nächsten
 * Rasterlinie, linker Rand auf der nächsten Spalte. Leer oder `free` (Alt gedrückt): kein Einrasten.
 */
export function placeText(setup: PageSetup, w: Vec, free = false, m: FontMetrics = DEFAULT_METRICS): TextPlacement {
  if (free || setup.background === "blank") return { x: w.x, y: w.y - 16 };
  const step = Math.max(1, setup.bgSpacingMm) * MM;
  const o = origin(setup, w);
  // Liniert: 8 mm → eine Textzeile pro Linie. Kariert 5 mm: eine Zeile pro Kästchen.
  const lh = step;
  const size = Math.max(8, lh * FONT_RATIO);
  // Grundlinie: die Linie unter dem Tippunkt (man tippt typischerweise in die Zeile)
  const line = o.y + Math.ceil((w.y - o.y) / step) * step;
  const baselineInBox = (lh - (m.ascent + m.descent) * size) / 2 + m.ascent * size;
  const y = line - baselineInBox;
  const x = setup.background === "lines" ? w.x : o.x + Math.round((w.x - o.x) / step) * step;
  return { x, y, size, lineHeight: lh, padX: setup.background === "lines" ? undefined : 0 };
}

/** Schriftmetrik im Browser messen (Canvas, keine DOM-Änderung). */
export function measureMetrics(family: string): FontMetrics {
  try {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return DEFAULT_METRICS;
    c.font = `100px ${family}`;
    const t = c.measureText("Hg");
    if (!t.fontBoundingBoxAscent) return DEFAULT_METRICS;
    return { ascent: t.fontBoundingBoxAscent / 100, descent: t.fontBoundingBoxDescent / 100 };
  } catch {
    return DEFAULT_METRICS;
  }
}
