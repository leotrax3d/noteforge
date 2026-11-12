// Eingebaute Seitenvorlagen (SPEC §5). Eigene Vorlagen speichert das Backend.
import { strokeToElement } from "@/canvas/core/codec";
import { MM, a4Size } from "@/canvas/core/layout";
import { PSTRIDE, makeStroke, uid } from "@/canvas/core/model";
import { makeObj, objToElement, type TableObj, type TextObj } from "@/canvas/core/objects";
import type { CanvasElement, PagePatch } from "@/lib/types";

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  setup: PagePatch;
  build?: (pageId: string) => CanvasElement[];
}

class Builder {
  z = 0;
  out: CanvasElement[] = [];
  constructor(private pageId: string) {}
  text(xMm: number, yMm: number, wMm: number, html: string) {
    const o = makeObj<TextObj>({ id: uid(), kind: "text", z: this.z++, x: xMm * MM, y: yMm * MM, w: wMm * MM, h: 44, angle: 0, data: { html } });
    this.out.push(objToElement(o, this.pageId));
  }
  table(xMm: number, yMm: number, wMm: number, cells: string[][]) {
    const h = cells.length * 44;
    const o = makeObj<TableObj>({ id: uid(), kind: "table", z: this.z++, x: xMm * MM, y: yMm * MM, w: wMm * MM, h, angle: 0, data: { cells } });
    this.out.push(objToElement(o, this.pageId));
  }
  /** Gerade Linie als Kugelschreiber-Strich (mm). */
  line(x0: number, y0: number, x1: number, y1: number, color = "#64748b") {
    const n = 2;
    const p = new Float32Array(n * PSTRIDE);
    p.set([x0 * MM, y0 * MM, 0.5, 0, 0, x1 * MM, y1 * MM, 0.5, 0, 16]);
    this.out.push(strokeToElement(makeStroke({ id: uid(), pen: "ballpoint", color, width: 1.6, opacity: 1, pressure: false, points: p, z: this.z++ }), this.pageId));
  }
}

const A4W = a4Size("portrait").w / MM; // 210
const M = 15; // Rand in mm
const blankRows = (cols: string[], n: number) => [cols.map((c) => `<b>${c}</b>`), ...Array.from({ length: n }, () => cols.map(() => ""))];

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "builtin:blank",
    name: "Leeres Blatt",
    description: "Endlos, kariert",
    setup: {},
  },
  {
    id: "builtin:cornell",
    name: "Cornell-Notizen",
    description: "Stichworte, Notizen, Zusammenfassung",
    setup: { mode: "a4", orientation: "portrait", background: "lines", bgSpacingMm: 8 },
    build: (pid) => {
      const b = new Builder(pid);
      b.text(M, 8, A4W - 2 * M, "<h2>Thema: </h2>");
      b.line(M, 30, A4W - M, 30);
      b.line(65, 30, 65, 235);
      b.line(M, 235, A4W - M, 235);
      b.text(M, 32, 48, "<b>Stichworte / Fragen</b>");
      b.text(68, 32, A4W - M - 68, "<b>Notizen</b>");
      b.text(M, 238, A4W - 2 * M, "<b>Zusammenfassung</b>");
      return b.out;
    },
  },
  {
    id: "builtin:protocol",
    name: "Versuchsprotokoll",
    description: "Für Physik, Chemie, Biologie",
    setup: { mode: "a4", orientation: "portrait", background: "lines", bgSpacingMm: 8 },
    build: (pid) => {
      const b = new Builder(pid);
      b.text(M, 8, A4W - 2 * M, "<h1>Versuch: </h1><p>Datum: · Gruppe: </p>");
      const parts = ["Fragestellung", "Vermutung", "Material", "Durchführung / Skizze", "Beobachtung", "Auswertung"];
      parts.forEach((t, i) => b.text(M, 40 + i * 42, A4W - 2 * M, `<h3>${t}</h3>`));
      return b.out;
    },
  },
  {
    id: "builtin:vocab",
    name: "Vokabelliste",
    description: "Tabelle Deutsch – Fremdsprache",
    setup: { mode: "a4", orientation: "portrait", background: "blank" },
    build: (pid) => {
      const b = new Builder(pid);
      b.text(M, 8, A4W - 2 * M, "<h2>Vokabeln: Lektion </h2>");
      b.table(M, 26, A4W - 2 * M, blankRows(["Deutsch", "Fremdsprache", "Beispielsatz"], 18));
      return b.out;
    },
  },
  {
    id: "builtin:math",
    name: "Mathe (kariert)",
    description: "DIN A4, 5-mm-Kästchen",
    setup: { mode: "a4", orientation: "portrait", background: "grid", bgSpacingMm: 5 },
    build: (pid) => {
      const b = new Builder(pid);
      b.text(M, 6, A4W - 2 * M, "<h2>Aufgabe </h2>");
      return b.out;
    },
  },
  {
    id: "builtin:week",
    name: "Wochenplan",
    description: "Querformat, Montag bis Freitag",
    setup: { mode: "a4", orientation: "landscape", background: "blank" },
    build: (pid) => {
      const b = new Builder(pid);
      const w = a4Size("landscape").w / MM;
      b.text(M, 8, w - 2 * M, "<h2>Woche vom </h2>");
      b.table(M, 26, w - 2 * M, blankRows(["Stunde", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"], 8).map((r, i) => (i ? [`${i}.`, ...r.slice(1)] : r)));
      return b.out;
    },
  },
  {
    id: "builtin:exam",
    name: "Lernzettel für KA",
    description: "Themen, Formeln, typische Fehler",
    setup: { mode: "a4", orientation: "portrait", background: "dots", bgSpacingMm: 5 },
    build: (pid) => {
      const b = new Builder(pid);
      b.text(M, 8, A4W - 2 * M, "<h1>Klassenarbeit: </h1><p>Datum: </p>");
      b.text(M, 40, A4W - 2 * M, "<h3>Was kommt dran?</h3><ul><li></li></ul>");
      b.text(M, 110, A4W - 2 * M, "<h3>Wichtige Formeln / Regeln</h3>");
      b.text(M, 180, A4W - 2 * M, "<h3>Typische Fehler</h3><ul><li></li></ul>");
      return b.out;
    },
  },
];
