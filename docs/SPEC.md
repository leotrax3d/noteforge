# Noteforge – Spezifikation

## 1. Ziel
Desktop-App für Windows (Lenovo Yoga mit Stift), die OneNote für den Schulalltag ersetzt: handschriftliche Notizen pro Fach, Stundenplan aus WebUntis, Kurse/Termine aus Moodle BW, Kalender für Klassenarbeiten.

## 2. Plattform & Stack
- Nur Windows 10/11, Tauri 2 + WebView2
- React + TypeScript + Tailwind + shadcn/ui
- SQLite (lokal), Ink-Daten als komprimierte Binärblobs pro Blatt
- Sync: Datenordner über Nextcloud (WebDAV) des Homeservers

## 3. Datenmodell
```
Subject      id, name, color, icon, order, webuntisSubjectId?, moodleCourseId?
Section      id, subjectId, name, color, order          (= Themengruppe)
Page         id, sectionId, parentPageId?, title, order,
             mode: "infinite" | "a4", orientation: "portrait" | "landscape",
             background: "grid" | "lines" | "dots" | "blank",
             bgSpacingMm, pageColor, createdAt, updatedAt
Element      id, pageId, type: stroke | shape | text | image | pdfPage | file | table,
             z, bbox, data (binary/json)
Tag          id, name, icon, color
ElementTag   elementId, tagId
Event        id, subjectId?, type: exam | test | deadline | other,
             title, start, end?, note, source: manual | moodle
PageVersion  id, pageId, snapshot, createdAt
```
Strokes: Punkte als `Float32Array` (x, y, pressure, tilt, t), Stift-ID, Farbe, Breite, Opazität.

## 4. Canvas
- **Modi:** endlos (unbegrenzt in alle Richtungen, Tiles) oder DIN A4 (210×297 mm, untereinander gestapelt, neue Seite automatisch beim Schreiben unten). Pro Blatt wählbar, nachträglich umschaltbar.
- **Hintergründe:** kariert (5 mm Standard), liniert (Lineatur 8 mm), punktiert, leer; Abstand einstellbar.
- **Rendering:** Hintergrund-Pattern gecacht, gespeicherte Striche in Tile-Bitmaps, aktiver Strich auf eigenem Layer (low latency, `desynchronized: true`). Ziel: < 16 ms Frame, Eingabelatenz so niedrig wie möglich.
- **Zoom:** 10 %–800 %, Pinch, Strg+Mausrad.
- **Stifte:** Füller (druckabh.), Kugelschreiber (konstant), Bleistift (Textur), Textmarker (transparent, unter Schrift), Radierer (strichweise / partiell), Stift-Radierende automatisch erkannt.
- **Farben:** Palette + eigene Farben; 5–8 Stift-Presets.
- **Lasso:** auswählen, verschieben, skalieren, drehen, Farbe ändern, kopieren, löschen, in Text umwandeln.
- **Lineal:** Overlay, 2 Finger drehen/verschieben, Winkelanzeige, Stift rastet an Kante.
- **Geodreieck:** wie Lineal + Winkelskala, Kanten zum Zeichnen.
- **Zirkel:** Mittelpunkt + Radius, Kreis/Bogen.
- **Freihand → Form:** Stift am Strichende ~500 ms halten → Linie, Pfeil, Kreis/Ellipse, Rechteck, Dreieck, Polygon. Auch als dauerhafter Modus.
- **Text:** freie Textcontainer überall (Klick/Tastatur), Rich Text, Listen, Überschriften, Tabellen.
- **Medien:** Bilder (Einfügen, Drag & Drop, Screenshot-Ausschnitt), Dateianhänge, PDF-Import als Hintergrundseiten.
- **Undo/Redo:** Befehls-Stack, unbegrenzt pro Sitzung.
- **Gesten:** 2 Finger Zoom/Pan, 2-Finger-Tipp Undo, 3-Finger-Tipp Redo.

## 5. OneNote-Funktionen
Unterseiten, Drag & Drop-Sortierung, Tags (To-Do, Wichtig, Frage, Lernen für KA, eigene) mit Tag-Übersicht, Seitenlinks `[[…]]`, Volltextsuche (Text + erkannte Handschrift + OCR), Seitenvorlagen, Seitenversionen, Papierkorb, Ink-Wiedergabe, PDF-Export (Blatt/Themengruppe/Fach), Drucken.

## 6. KI-/Erkennungsfunktionen (lokal bevorzugt)
- **Handschrift → Text / Suche:** Windows.UI.Input.Inking `InkAnalyzer` über Rust-WinRT-Bindings (offline, Deutsch).
- **Ink → LaTeX:** Formel per Lasso markieren → LaTeX (Modell z. B. lokal via ONNX, Fallback Online-API), Anzeige mit KaTeX.
- **OCR in Bildern:** `Windows.Media.Ocr` (offline, Deutsch).

## 7. UI / Design
- shadcn/ui, Hell + Dunkel + System; Akzentfarbe = Fachfarbe.
- Stiftoptimiert: Touch-Ziele ≥ 44 px, schwebende andockbare Werkzeugleiste, Radialmenü (Stifttaste / Long-Press), Linkshänder-Modus, Fokusmodus.
- Dunkler Canvas: Seite dunkel, Tinte intelligent invertiert (Luminanz-Inversion, Farbton bleibt), gespeichert wird Originalfarbe.
- **Screens:** Startseite (Fächer-Kacheln, heutiger Stundenplan, nächste Klassenarbeiten mit Countdown, zuletzt bearbeitet), Fach-Ansicht (Sidebar Themengruppen/Blätter + Canvas), Kalender (Monat/Woche mit Stundenplan), Suche, Einstellungen.

## 8. Integrationen
- **WebUntis:** inoffizielle JSON-RPC-API (`/WebUntis/jsonrpc.do?school=…`), Login Schulname/Benutzer/Passwort, Stundenplan + Vertretungen + Ausfälle, Cache in SQLite, Fach-Mapping. „Aktuelle Stunde öffnen“ springt ins Fach.
- **Moodle BW:** Token über `/login/token.php?service=moodle_mobile_app`, Webservice-Funktionen `core_enrol_get_users_courses`, `core_course_get_contents`, `core_calendar_get_action_events_by_timesort`; PDFs als Blatt importieren.
- Zugangsdaten im Windows Credential Manager.

## 9. Sync
Datenordner (SQLite + Blobs) mit Nextcloud über WebDAV; Konflikte pro Blatt (neuere Version gewinnt, ältere als PageVersion erhalten). Automatisches lokales Backup täglich.

## 10. Phasen
0 Gerüst + Stift-Latenztest · 1 Struktur/DB/Startseite · 2 Canvas-Kern · 3 Werkzeuge · 4 OneNote-Funktionen · 5 Kalender · 6 WebUntis + Moodle · 7 Erkennung (Handschrift, LaTeX, OCR) · 8 Sync, Export, Feinschliff
