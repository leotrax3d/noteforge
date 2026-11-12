/** Alle Tastenkürzel an einer Stelle – Quelle für die Hilfe (F1). */
export interface Shortcut { keys: string[]; label: string }
export interface ShortcutGroup { title: string; items: Shortcut[] }

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Allgemein",
    items: [
      { keys: ["Strg", "K"], label: "Befehlspalette" },
      { keys: ["Strg", "F"], label: "Suche" },
      { keys: ["Strg", ","], label: "Einstellungen" },
      { keys: ["F1"], label: "Diese Übersicht (auch ?)" },
      { keys: ["F11"], label: "Fokusmodus ein/aus (auch Strg+Umschalt+F)" },
      { keys: ["Strg", "Umschalt", "S"], label: "Jetzt mit Nextcloud synchronisieren" },
      { keys: ["Strg", "Umschalt", "P"], label: "Leistungsanzeige ein/aus" },
      { keys: ["Strg", "Umschalt", "D"], label: "Debug-Ansicht Stift (Rohpunkte, Druck, Umriss, FPS)" },
      { keys: ["Alt", "Pos1"], label: "Zur Startseite" },
      { keys: ["Alt", "H"], label: "Hausaufgaben" },
      { keys: ["Alt", "N"], label: "Noten" },
      { keys: ["Strg", "Umschalt", "R"], label: "Taschenrechner ein/aus" },
      { keys: ["Strg", "Umschalt", "G"], label: "Funktionsplotter" },
    ],
  },
  {
    title: "Blatt",
    items: [
      { keys: ["Strg", "N"], label: "Neues Blatt im Thema" },
      { keys: ["Strg", "S"], label: "Sofort speichern" },
      { keys: ["Strg", "Z"], label: "Rückgängig" },
      { keys: ["Strg", "Y"], label: "Wiederholen (auch Strg+Umschalt+Z)" },
      { keys: ["Strg", "+"], label: "Vergrößern" },
      { keys: ["Strg", "−"], label: "Verkleinern" },
      { keys: ["Strg", "0"], label: "Ansicht zurücksetzen" },
      { keys: ["Entf"], label: "Auswahl löschen" },
      { keys: ["Esc"], label: "Auswahl aufheben / Fokusmodus beenden" },
    ],
  },
  {
    title: "Werkzeuge",
    items: [
      { keys: ["B"], label: "Stift" },
      { keys: ["M"], label: "Textmarker" },
      { keys: ["E"], label: "Radierer" },
      { keys: ["L"], label: "Lasso" },
      { keys: ["T"], label: "Text (auch Strg+Umschalt+T)" },
      { keys: ["H"], label: "Hand (verschieben)" },
      { keys: ["R"], label: "Formerkennung ein/aus" },
      { keys: ["1", "…", "9"], label: "Stift-Favorit 1–9" },
    ],
  },
];

/** Tastatur-Eingabe in einem Feld → keine Einzeltasten-Kürzel auslösen. */
export function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
