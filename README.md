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

### OneNote-Funktionen (Phase 4)
- **Tags:** Lasso-Auswahl oder Textfeld → „Tag“ (To-Do, Wichtig, Frage, Lernen für KA, eigene Tags mit Symbol/Farbe). Symbole erscheinen links neben der Stelle, To-Dos lassen sich direkt abhaken. **Tag-Übersicht** (Startseite/Fach-Kopfzeile) gruppiert nach Fach und Blatt, Filter „Nur offene To-Dos“, Tippen springt zur Stelle.
- **Seitenlinks:** `[[Blatttitel]]` in Textfeldern/Tabellen wird zum Link (Formatleiste: „Seitenlink einfügen“ mit Blattsuche). Existiert das Blatt nicht, wird es angelegt.
- **Volltextsuche:** Strg+K / Strg+F. SQLite FTS5 (`unicode61`, Diakritika egal, Präfixsuche) über Titel, Textfelder, Tabellen und Text importierter PDFs.
- **Seitenvorlagen:** Cornell-Notizen, Versuchsprotokoll, Vokabelliste, Mathe (kariert), Wochenplan, Lernzettel für KA; eigene Vorlagen über Blatt-Aktionen → „Als Vorlage speichern“.
- **Seitenversionen:** automatisch beim Öffnen/Verlassen eines geänderten Blatts (≥ 10 min Abstand, max. 50, zlib-komprimierte Snapshots), manuell sicherbar, Wiederherstellen sichert vorher den aktuellen Stand.
- **Papierkorb:** Löschen verschiebt Blätter samt Unterseiten in den Papierkorb (30 Tage, danach automatisch endgültig gelöscht).
- **PDF-Import:** Themengruppe → „PDF als Blatt importieren“ (neues A4-Blatt) oder Einfügen → „PDF-Seiten“ ins aktuelle Blatt. Seiten werden als feste Hintergrundseiten (`pdfPage`) gerastert (pdf.js), ihr Text ist durchsuchbar.
- **PDF-Export:** Blatt-Aktionen → Blatt / Themengruppe / ganzes Fach. A4-Blätter 1:1, Endlosblätter auf A4-Breite eingepasst; eigener PDF-Writer (JPEG je Seite), Speichern über den Tauri-Dialog (Rust schreibt die Datei).
- **Ink-Wiedergabe:** ▶ in der Blatt-Kopfzeile spielt die Handschrift in Entstehungsreihenfolge mit echtem Schreibtempo ab (1×–8×, Zeitleiste, Leertaste/Esc).

### Kalender (Phase 5)
- **Monat/Woche** (Startseite → „Kalender“): Woche beginnt Montag, KW-Anzeige, „Heute“, Tag antippen öffnet die Woche; „+“ im Tag bzw. Stundenraster legt einen Termin an.
- **Termine** nach SPEC §3: Klassenarbeit, Test, Abgabe, Sonstiges – mit Fach (Fachfarbe), Datum, optional Uhrzeit/Ende (ohne Uhrzeit ganztägig), Notiz.
- **Erinnerungen** als Windows-Benachrichtigung (`tauri-plugin-notification`): Vorlauf wählbar (Beginn … 1 Woche, Vorschlag je Typ). Ein Rust-Hintergrund-Thread prüft alle 20 s; jede Erinnerung kommt genau einmal, Verschieben des Termins setzt sie zurück.
- **Startseiten-Widget „Nächste Klassenarbeiten“** mit Tages-Countdown (rot ab 3 Tagen), minütlich aktualisiert.

### WebUntis & Moodle BW (Phase 6)
- **Startseite → Konten:** WebUntis (Server, Schulkürzel, Benutzer, Passwort) und Moodle BW (Adresse + Benutzer/Passwort oder Token für SSO-Konten) verbinden. Passwort bzw. Moodle-Token liegen nur im Windows Credential Manager (`keyring`), in SQLite stehen nur Server/Schule/Benutzername.
- **Fächer zuordnen:** Noteforge-Fach ↔ WebUntis-Fach ↔ Moodle-Kurs, mit automatischem Vorschlag nach Namen.
- **Stundenplan** (inkl. Vertretungen/Ausfälle) wird im Rust-Backend per JSON-RPC geholt, in SQLite gecacht (Vorwoche bis +5 Wochen) und alle 15 min beim Öffnen der Startseite abgeglichen. Er erscheint in der Wochenansicht des Kalenders und als „Heute“-Leiste auf der Startseite.
- **„Aktuelle Stunde öffnen“** springt ins zugeordnete Fach (zuletzt bearbeitetes Blatt); vor Unterrichtsbeginn heißt der Knopf „Nächste Stunde öffnen“.
- **Moodle-Abgaben** (`core_calendar_get_action_events_by_timesort`) werden als Termine vom Typ „Abgabe“ mit Erinnerung 1 Tag vorher übernommen; eigene Notizen bleiben beim Abgleich erhalten, entfallene Abgaben werden entfernt.
- **PDF aus Moodle:** Themengruppen-Menü → „PDF aus Moodle …“ listet die PDFs des zugeordneten Kurses; der Download läuft über das Backend (Token verlässt die Instanz nie) und wird wie ein lokales PDF als A4-Blatt importiert.
- Im Browser (`pnpm dev`) ersetzt ein Demo-Backend beide Dienste durch einen erfundenen Stundenplan.
