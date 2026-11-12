# Noteforge

Stiftoptimierte Schul-Notiz-App für Windows – OneNote-Funktionsumfang, WebUntis-Stundenplan, Moodle BW und Klassenarbeiten-Kalender.

## Features (Ziel)
- Fächer → Theman → Blätter (mit Unterseiten)
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
- **PDF-Import:** Thema → „PDF als Blatt importieren“ (neues A4-Blatt) oder Einfügen → „PDF-Seiten“ ins aktuelle Blatt. Seiten werden als feste Hintergrundseiten (`pdfPage`) gerastert (pdf.js), ihr Text ist durchsuchbar.
- **PDF-Export:** Blatt-Aktionen → Blatt / Thema / ganzes Fach. A4-Blätter 1:1, Endlosblätter auf A4-Breite eingepasst; eigener PDF-Writer (JPEG je Seite), Speichern über den Tauri-Dialog (Rust schreibt die Datei).
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
- **PDF aus Moodle:** Theman-Menü → „PDF aus Moodle …“ listet die PDFs des zugeordneten Kurses; der Download läuft über das Backend (Token verlässt die Instanz nie) und wird wie ein lokales PDF als A4-Blatt importiert.
- Im Browser (`pnpm dev`) ersetzt ein Demo-Backend beide Dienste durch einen erfundenen Stundenplan.

### Erkennung (Phase 7)
- **Handschrift → Suche:** Nach dem Speichern (4 s Ruhe) erkennt das Backend die Schrift des Blatts mit dem Windows-`InkAnalyzer` (WinRT, offline). Textmarker werden ignoriert. Das Ergebnis liegt in `page_ink` und fließt in den FTS-Index (`page_fts`). Ein Hash über die Striche sorgt dafür, dass nur bei Änderungen neu erkannt wird.
- **OCR in Bildern:** `Windows.Media.Ocr` mit `de-DE`, ersatzweise mit einer Sprache aus dem Benutzerprofil. Eingefügte Bilder und Screenshots werden automatisch in `image_ocr` erkannt und sind dann über die Suche auffindbar. Im Lasso-Menü eines Bildes zeigt „Text im Bild erkennen“ den Text an; er lässt sich dort kopieren oder als Textfeld einfügen.
- **Handschrift → Text:** Lasso → „In Text umwandeln“ ersetzt die Striche durch ein Textfeld. Der Schritt lässt sich rückgängig machen.
- **Ink → LaTeX:** Lasso → „Als Formel (LaTeX)“. Aus den erkannten Wörtern und ihrer Lage werden Bruchstriche sowie Hoch- und Tiefstellung rekonstruiert, und Symbole werden übersetzt (`src/features/recognition/latex.ts`). Im Dialog lässt sich das Ergebnis mit KaTeX-Vorschau und Bausteinen korrigieren. Wahlweise bleibt die Handschrift erhalten. Im Textwerkzeug öffnet ein Tipp auf eine Formel den Dialog erneut. Der PDF-Export setzt Formeln als einzeiligen Text, z. B. `(a+b)/c`.
- **Voraussetzung unter Windows:** Einstellungen → Zeit und Sprache → Sprache → Deutsch → Optionen → „Handschrift“ und „Optische Zeichenerkennung“ installieren. Der `InkAnalyzer` verwendet den Handschrift-Erkenner des Systems.
- **Grenzen:** Im Browser (`pnpm dev`) ist keine Erkennung verfügbar. Dort meldet der LaTeX-Dialog das, und die Formel kann von Hand eingegeben werden. Ein lokales ONNX-Formelmodell (SPEC §6) kann später als weitere Quelle für `inkToLatex` dazukommen.

### Sync & Feinschliff (Phase 8)
- **Nextcloud-Sync (WebDAV, SPEC §9)** in `src-tauri/src/sync/`: Auf dem Server liegen `struct.json.gz` (Fächer, Theman, Tags, Vorlagen, eigene Termine) und `pages/<id>.json.gz` je Blatt (inklusive Bildern und PDF-Seiten). Die Zugangsdaten sind Server, Benutzer und App-Passwort; das App-Passwort liegt nur im Credential Manager. Der Abgleich läuft manuell, alle 5, 15 oder 60 Minuten oder mit Strg+Umschalt+S.
- **Zeitsynchronisation:**
  - Geänderte Blätter werden ohne Uhrzeit erkannt: lokal über einen Fingerabdruck je Blatt, auf dem Server über ETags. Uploads sind mit `If-Match`/`If-None-Match` geschützt.
  - Die Zeit zählt nur, wenn beide Seiten dasselbe Blatt geändert haben. Dann gewinnt die neuere Version, die ältere bleibt als Seitenversion „Sync-Konflikt …“ erhalten.
  - Für diesen Vergleich rechnet Noteforge alle Bearbeitungszeiten in **Serverzeit** um. Die Abweichung der Geräte-Uhr wird bei jedem Sync aus dem `Date`-Header gemessen; es gilt die Probe mit der kürzesten Laufzeit.
  - Zeiten, die in der Zukunft liegen, werden auf „jetzt“ gekürzt. Das betrifft Uhren, die beim Bearbeiten vorgingen und inzwischen korrigiert sind.
  - Ab 2 Minuten Abweichung erscheint ein Hinweis in den Einstellungen.
- Die Struktur wird per Drei-Wege-Abgleich gegen den letzten gemeinsamen Stand zusammengeführt. Endgültig gelöschte Blätter werden in beide Richtungen übertragen, der Papierkorb wird mitsynchronisiert. Moodle-Termine und Erinnerungsstatus bleiben gerätelokal.
- **Backup:** Einmal täglich wird mit `VACUUM INTO` nach `%APPDATA%\de.noteforge.app\backups` gesichert. Die letzten 14 Backups bleiben erhalten. In den Einstellungen gibt es zusätzlich „Jetzt sichern“.
- **Einstellungen** (Strg+,): Nextcloud, Backup, Linkshänder-Modus (Seitenleiste rechts, senkrechte Werkzeugleiste gespiegelt) und Leistungsanzeige.
- **Fokusmodus** (F11 oder Strg+Umschalt+F, beenden mit Esc): Es bleiben nur Blatt und Werkzeugleiste sichtbar, in der App im Vollbild.
- **Tastenkürzel** (F1 zeigt die Übersicht): B/M/E/L/T/H/R für die Werkzeuge, 1–9 für die Stift-Favoriten, Strg+N für ein neues Blatt. Alle Kürzel stehen in `src/lib/shortcuts.ts`.
- **Performance-Profiling** (Strg+Umschalt+P): Die Anzeige auf dem Blatt zeigt FPS, Frame- und Kachelzeit, Stift-Latenz und Ruckler. Messwerte aus dem Test mit 20 000 Strichen in Headless-Chromium:
  - Der Raster-Index (`StrokeStore.inRect`) halbiert etwa die Suche nach den Strichen pro Kachel (0,19 statt 0,34 ms).
  - Kacheln werden mit einem Zeitbudget statt einer festen Anzahl gerendert (8 ms pro Frame, nach einem Zoom 32 ms). Dadurch sank der längste Frame beim Zoomen von rund 55–75 ms auf rund 38 ms.
- **Installer:** Die CI baut MSI (WiX, de-DE) und NSIS (deutsch, Installation pro Benutzer, WebView2 per Bootstrapper) und lädt beide als Artefakt `noteforge-installer` hoch.

### Hausaufgaben & Noten (Phase 10)
- **Hausaufgaben** (Alt+H): eigene Aufgaben mit Fach und Frist, gruppiert nach Überfällig/Heute/Morgen/Woche/Später, abhaken mit 44-px-Kreis. Moodle-Abgaben werden beim Moodle-Abgleich automatisch übernommen (ID `moodle:<Event>`, Erledigt-Status und Notiz bleiben erhalten; Löschen blendet sie nur aus).
- **Noten** (Alt+N): Notensystem 1–6 (Eingabe auch `2-`/`2+`) oder 0–15 Punkte (Umrechnung beim Wechsel), Noten schriftlich/mündlich mit Gewicht, Fachgewichtung per Regler, Fach- und Gesamtschnitt, „Was brauche ich?“ für die nächste Leistung.
- Startseite: Widgets „Hausaufgaben“ und „Noten“. Beides wird über Nextcloud mitsynchronisiert (Struktur-Datei).
- Migration `0007_school.sql`, Backend `src-tauri/src/db/school.rs`, Rechenlogik `src/lib/school.ts` (getestet).

### Taschenrechner & Funktionsplotter (Phase 11)
- Panel über Einfügen-Menü, Strg+Umschalt+R (Rechner) bzw. Strg+Umschalt+G (Graph); wird erst beim Öffnen geladen (mathjs).
- **Rechner:** Tastenfeld mit 44-px-Tasten, Dezimalkomma, `;` als Argumenttrenner, DEG/RAD, Variablen (`a = 4`), `ans`, Verlauf, „Aufs Blatt“ fügt die Rechnung als Textfeld ein. Metafunktionen (`import`, `evaluate` …) sind in Ausdrücken gesperrt.
- **Plotter:** bis zu 6 Funktionen, Ziehen/Mausrad/Knöpfe zum Zoomen, Auto-y; Nullstellen (auch Berührpunkte, ohne Polstellen), Hoch-/Tiefpunkte und Schnittpunkte numerisch.
- **Auf dem Blatt:** Graph als SVG-Bild mit gespeicherter Spezifikation (`data.plot`) – auswählen → „Graph bearbeiten“ öffnet ihn wieder im Plotter, „aktualisieren“ ersetzt ihn in einem Rückgängig-Schritt.

### Stift, Rendering & Bedienung (Phase 12)
- **Saubere kleine Schrift:** Eingabefilter (Mindestabstand 0,3 px, Druckglättung, Spitzenkappung, Punkt/Kapsel für i-Punkte), Vorhersagepunkte nur pro Frame; Ursachenanalyse in `docs/analysis-pen-artifacts.md`. Debug-Ansicht **Strg+Umschalt+D** (Rohpunkte, Druck, Umriss, FPS).
- **Rendering:** nur `requestAnimationFrame` (folgt 60–144 Hz), Eingaben über `pointerrawupdate`. **Scharfe PDFs:** Original als Asset (Migration `0008_assets.sql`, mit dem Blatt synchronisiert), zoomabhängige 512-px-Kacheln (LRU, max. 192 MB), scharf nach 150 ms Ruhe.
- **Start ohne Aufblitzen:** Fenster unsichtbar bis zum ersten Frame, Theme vor dem React-Mount.
- **Canvas:** Doppelklick/-tipp erzeugt Textfeld mit Einrasten an Linien/Raster (Alt = frei); A4-Grenzen mit Gummiband; PDFs im Endlos-Canvas als freie Elemente; Greifbalken, Aufnehmen per langem Fingerdruck, Hilfslinien, Pfeiltasten.
- **WebUntis:** Freistunden (Lücke vs. Entfall) in Startseite und Kalender.
- **Einrichtungsassistent** beim ersten Start (10 Schritte, erneut unter Einstellungen → Stift & Bedienung oder Befehlspalette).
- **Logo** `assets/logo.svg`, konfigurierbare Stiftleiste, Befehlspalette **Strg+K**, Einstellungen mit Kategorien und Suche, Kontextmenüs, Helfer „Spitz“.
