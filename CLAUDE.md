# CLAUDE.md – Noteforge

## Projekt
Stiftoptimierte Schul-Notiz-App, nur Windows. Spezifikation: `docs/SPEC.md`. Lies sie vor jeder Phase.

## Stack
- Tauri 2 (Rust-Backend, WebView2)
- React 19 + TypeScript (strict) + Vite
- Tailwind CSS + shadcn/ui (Hell/Dunkel über CSS-Variablen)
- Zustand für State, SQLite über `rusqlite` im Rust-Backend
- Canvas: eigener Renderer (Canvas2D, später optional WebGL), `perfect-freehand` für Striche

## Regeln
- Performance zuerst: Canvas-Hot-Path ohne React-Re-Renders, keine Allokationen pro Pointer-Event wo vermeidbar.
- Pointer Events mit `getCoalescedEvents()` und `getPredictedEvents()` nutzen; `touch-action: none` auf dem Canvas.
- Palm Rejection: Wenn `pointerType === "pen"` aktiv, Touch-Eingaben auf dem Canvas ignorieren (außer Gesten mit 2+ Fingern).
- Alle Touch-Ziele ≥ 44 px.
- UI-Texte auf Deutsch.
- Zugangsdaten nur im Windows Credential Manager (`keyring`-Crate), nie in SQLite.
- Persistenz über Tauri-Commands, Frontend greift nie direkt aufs Dateisystem zu.
- Nach jeder Phase: `pnpm tauri build` muss durchlaufen, Tests grün.

## Struktur
```
src/            React-Frontend
  canvas/       Engine (Renderer, Tools, Hit-Test, Shape-Recognition)
  components/   shadcn + eigene UI
  features/     home, subject, calendar, settings
src-tauri/      Rust: db, sync, webuntis, moodle, ocr
docs/
```
