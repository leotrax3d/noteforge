# Noteforge

Stiftoptimierte Schul-Notiz-App für Windows – OneNote-Funktionsumfang, WebUntis-Stundenplan, Moodle BW und Klassenarbeiten-Kalender.

## Features (Ziel)
- Fächer → Themengruppen → Blätter (mit Unterseiten)
- Endloser Canvas **oder** DIN-A4-Seiten (pro Blatt wählbar)
- Hintergründe: kariert, liniert, punktiert, leer
- Druckempfindliche Stifte, Textmarker, Radierer, Lasso
- Lineal, Geodreieck, Freihand → Form
- Textcontainer, Bilder, Dateien, Tabellen, Tags, Seitenlinks, Suche
- PDF-Import/-Export
- Handschrift → Text/Suche, Ink → LaTeX, OCR in Bildern
- Startseite, Kalender mit Klassenarbeiten
- WebUntis- und Moodle-BW-Integration
- Hell/Dunkel (shadcn/ui), lokal + Nextcloud-Sync

## Stack
Tauri 2 · Rust · React · TypeScript · Tailwind · shadcn/ui · SQLite

## Doku
- [docs/SPEC.md](docs/SPEC.md) – Spezifikation
- [docs/PROMPTS.md](docs/PROMPTS.md) – Phasen-Prompts für Claude Code
- [CLAUDE.md](CLAUDE.md) – Regeln für KI-Agenten

## Entwicklung

```bash
pnpm install
pnpm tauri dev      # App starten
pnpm dev            # nur Frontend im Browser (In-Memory-Backend statt SQLite)
pnpm test           # Frontend-Tests (Vitest)
cd src-tauri && cargo test   # Rust-Tests (DB/Migrationen)
pnpm tauri build    # Windows-Installer (NSIS + MSI)
```

Die Datenbank liegt unter `%APPDATA%\de.noteforge.app\noteforge.sqlite` (Tauri `app_data_dir`).
Migrationen: `src-tauri/migrations/NNNN_*.sql`, versioniert über `PRAGMA user_version`.

### Canvas (Phase 2)

Engine ohne React unter `src/canvas/core/` (`engine.ts` = Eingabe, Gesten, Rendering):
gespeicherte Striche + Hintergrund in 512-px-Tiles, aktiver Strich auf eigener `desynchronized`-Ebene.
Striche werden binär (`codec.ts`) als `element.data` gespeichert; Autospeichern bündelt Änderungen
über den Command `save_elements` (eine Transaktion).

| Eingabe | Aktion |
|---|---|
| Stift / Maus / 1 Finger | aktives Werkzeug (Finger kann in den Blatteinstellungen auf „Verschieben“ gestellt werden) |
| Stift-Radierende | Radierer · Stift-Seitentaste: Lasso |
| 2 Finger | Zoom (10–800 %) und Verschieben · Tipp: Rückgängig · 3-Finger-Tipp: Wiederholen |
| Strg + Mausrad / Mausrad | Zoom / Verschieben (Mittlere Maustaste: Verschieben) |
| Strg+Z, Strg+Y, Strg+0, Entf, Esc | Rückgängig, Wiederholen, Ansicht zurücksetzen, Auswahl löschen, Auswahl aufheben |

### Werkzeuge (Phase 3)

Unter `src/canvas/tools/`: `shapes.ts` (Freihand → Form), `guides.ts` (Lineal, Geodreieck, Zirkel).
Text, Tabellen und Bilder sind Objekte (`src/canvas/core/objects.ts`, JSON in `element.data`, gemeinsamer Undo-Stack mit den Strichen).
Bilder werden in die Tiles gerendert (Tinte liegt darüber), Text und Tabellen liegen als DOM-Ebene über dem Canvas.

| Eingabe | Aktion |
|---|---|
| Stift am Strichende ~0,5 s halten | Linie, Pfeil, Kreis, Ellipse, Rechteck, Dreieck, Vieleck (Hilfsmittel → „Formmodus“ für immer) |
| Hilfsmittel → Lineal / Geodreieck | Stift nahe der Kante rastet ein; 1 Finger verschiebt, 2 Finger drehen (rastet bei 15° ein), Drehgriff für Maus/Stift |
| Hilfsmittel → Zirkel | Einstich ziehen, Stiftspitze-Griff stellt den Radius, Zeichnen ergibt Kreis/Bogen (Winkelanzeige) |
| Rechtsklick, Stift-Seitentaste kurz, Long-Press | Radialmenü (Stifte, Radierer, Lasso, Text, Rückgängig/Wiederholen) |
| Werkzeug „Text“, Tipp auf freie Stelle | Textcontainer mit Rich Text (Überschriften, Listen, Fett/Kursiv/Unterstrichen, Farbe, Tabelle im Text) |
| Einfügen → Bild, Strg+V, Drag & Drop | Bild einfügen (max. 2000 px); mit dem Lasso antippen zum Verschieben/Skalieren/Drehen |
| Einfügen → Screenshot-Ausschnitt | Bildschirm aufnehmen und Ausschnitt wählen |
| Einfügen → Tabelle | Tabelle mit Zeilen/Spalten hinzufügen/entfernen |
