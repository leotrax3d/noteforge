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
