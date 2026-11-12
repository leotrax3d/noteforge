# Phasen-Prompts für Claude Code

Jede Phase in einer neuen Session starten. Immer zuerst: „Lies CLAUDE.md und docs/SPEC.md.“

## Phase 0 – Gerüst & Stift-Latenztest
> Lies CLAUDE.md und docs/SPEC.md. Erstelle mit `pnpm create tauri-app` ein Tauri-2-Projekt (React + TS + Vite) in diesem Repo. Richte Tailwind und shadcn/ui ein, mit Theme-Provider (Hell/Dunkel/System) und Umschalter. Baue eine Testseite mit Vollbild-Canvas: Pointer Events mit coalesced + predicted events, `perfect-freehand`, druckabhängige Breite, Palm Rejection, FPS- und Latenzanzeige. Ziel: flüssiges Schreiben mit dem Stift auf Windows.

## Phase 1 – Struktur, Datenbank, Startseite
> Implementiere das Datenmodell aus SPEC §3 in SQLite (rusqlite, Migrationen) mit Tauri-Commands für CRUD. Baue: Startseite mit Fächer-Kacheln (anlegen, Farbe/Icon, sortieren), Fach-Ansicht mit Sidebar (Themengruppen, Blätter, Unterseiten, Drag & Drop) und leerem Canvas-Platzhalter. Stiftoptimiert, Touch-Ziele ≥ 44 px.

## Phase 2 – Canvas-Kern
> Baue die Canvas-Engine nach SPEC §4: Modus endlos und DIN A4 (pro Blatt wählbar), Hintergründe kariert/liniert/punktiert/leer, Tile-Rendering, Zoom/Pan mit Gesten, Stifte (Füller, Kugelschreiber, Bleistift, Textmarker), Radierer (strichweise/partiell, Stift-Radierende), Farbpalette + Presets, Lasso (verschieben/skalieren/drehen/Farbe), Undo/Redo, Autospeichern. Dunkler Canvas mit Tinten-Inversion. Schwebende Werkzeugleiste.

## Phase 3 – Werkzeuge
> Implementiere Lineal, Geodreieck und Zirkel als Overlays (2-Finger-Drehen, Winkelanzeige, Einrasten), Freihand→Form (Hold-Erkennung, Linie/Pfeil/Kreis/Ellipse/Rechteck/Dreieck/Polygon), Radialmenü, Textcontainer mit Rich Text, Bilder einfügen/Screenshot-Ausschnitt, Tabellen.

## Phase 4 – OneNote-Funktionen
> Tags + Tag-Übersicht, Seitenlinks `[[…]]`, Volltextsuche (SQLite FTS5), Seitenvorlagen, Seitenversionen, Papierkorb, PDF-Import als Blatt, PDF-Export, Ink-Wiedergabe.

## Phase 5 – Kalender
> Kalender (Monat/Woche) mit Terminen nach SPEC §3 (Klassenarbeit, Test, Abgabe), Erinnerungen per Windows-Benachrichtigung, Startseiten-Widget „Nächste Klassenarbeiten“ mit Countdown.

## Phase 6 – WebUntis & Moodle BW
> Rust-Module für WebUntis (JSON-RPC) und Moodle BW (Token + Webservices) nach SPEC §8, Zugangsdaten im Credential Manager, Fach-Mapping-Dialog, Stundenplan im Kalender und auf der Startseite, „Aktuelle Stunde öffnen“, Moodle-Abgaben als Termine, PDF-Import aus Moodle-Kursen.

## Phase 7 – Erkennung
> Handschrift→Text und Handschrift-Suche über Windows InkAnalyzer, OCR in Bildern über Windows.Media.Ocr (beides Deutsch, offline), Ergebnisse in FTS-Index. Ink→LaTeX per Lasso mit KaTeX-Vorschau.

## Phase 8 – Sync & Feinschliff
> Nextcloud-Sync über WebDAV nach SPEC §9, tägliches Backup, Linkshänder-Modus, Fokusmodus, Tastenkürzel, Performance-Profiling, Installer (MSI/NSIS).
