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
Section      id, subjectId, name, color, order          (= Thema)
Page         id, sectionId, parentPageId?, title, order,
             mode: "infinite" | "a4", orientation: "portrait" | "landscape",
             background: "grid" | "lines" | "dots" | "blank",
             bgSpacingMm, pageColor, titleSource: "auto" | "manual", createdAt, updatedAt
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
  - Gezeichnet wird ausschließlich per `requestAnimationFrame` (folgt automatisch 60/90/120/144 Hz), keine feste FPS-Grenze. Eingaben (`pointerrawupdate`, wo verfügbar, sonst `pointermove` + `getCoalescedEvents()`) werden nur gesammelt.
  - Eingabefilter: Mindestabstand 0,3 Bildschirmpixel (in Welt umgerechnet), gleitender Druck-Mittelwert (4 Punkte), Kappung von Druckspitzen an Strichanfang/-ende, breitenabhängige perfect-freehand-Parameter, sehr kurze Striche als Punkt/Kapsel. Vorhersagepunkte (`getPredictedEvents()`) nur für den aktuellen Frame, nie im Strich. Füllregel „nonzero“, Rendering in devicePixelRatio, keine Koordinatenrundung.
  - Debug-Ansicht **Strg+Umschalt+D**: Rohpunkte (Farbe = Druck), Umriss-Polygon, FPS/Latenz.
  - **PDF-Seiten:** Original-PDF wird als Asset (Tabelle `asset`, mit dem Blatt synchronisiert) gespeichert und zoomabhängig (Zoom × DPR, Stufen als Zweierpotenzen) in 512-px-Kacheln mit pdf.js gerendert; LRU-Cache max. 192 MB. Beim Zoomen erst die vorhandene Stufe skaliert, nach 150 ms Ruhe die scharfe Stufe. Nur sichtbare Kacheln. Ohne Asset (alte Blätter): Vorschaubild.
- **Start:** Fenster startet unsichtbar, Theme/Hintergrund werden vor dem React-Mount gesetzt, Anzeige nach dem ersten fertigen Frame.
- **Zoom:** 10 %–800 %, Pinch, Strg+Mausrad.
- **Stifte:** Füller (druckabh.), Kugelschreiber (konstant), Bleistift (Textur), Textmarker (transparent, unter Schrift), Radierer (strichweise / partiell), Stift-Radierende automatisch erkannt.
- **Farben:** Palette + eigene Farben; 5–8 Stift-Presets.
- **Lasso:** auswählen, verschieben, skalieren, drehen, Farbe ändern, kopieren, löschen, in Text umwandeln.
- **Lineal:** Overlay, 2 Finger drehen/verschieben, Winkelanzeige, Stift rastet an Kante.
- **Geodreieck:** wie Lineal + Winkelskala, Kanten zum Zeichnen.
- **Zirkel:** Mittelpunkt + Radius, Kreis/Bogen.
- **Freihand → Form:** Stift am Strichende ~500 ms halten → Linie, Pfeil, Kreis/Ellipse, Rechteck, Dreieck, Polygon. Auch als dauerhafter Modus.
- **Text:** freie Textcontainer überall (Klick/Tastatur), Rich Text, Listen, Überschriften, Tabellen.
  - Wie OneNote: Doppelklick (Maus) bzw. Doppeltipp (Finger) mit jedem Werkzeug erzeugt dort ein Textfeld (mit dem Stift nur im Textwerkzeug – Umlautpunkte würden sonst Textfelder erzeugen). Dabei entstandene Tipp-Punkte werden entfernt.
  - Grundlinie rastet an der nächsten Linie (liniert) bzw. Rasterlinie (kariert/punktiert, dazu linker Rand an der Spalte) ein; Zeilenhöhe = Linienabstand, Schriftgröße = 0,62 × Abstand. Leeres Blatt: kein Einrasten. Alt gedrückt: Einrasten aus.
- **A4-Grenzen:** Scrollen seitlich auf Seitenbreite + 40 px Rand (schmaler → zentriert), oben bis zur ersten Seite, unten bis zur letzten Seite + „Seite hinzufügen“-Zone. Am Rand Gummiband-Abbremsung, nach dem Loslassen federt die Ansicht zurück.
- **Elemente verschieben:** Greifbalken über Bild/PDF bei Hover (Maus/Stift) oder Antippen; Textfelder zeigen ihren Balken bei Maus-Hover oder langem Fingerdruck. Lasso-Auswahl mit jedem Werkzeug direkt ziehbar. Finger lange drücken nimmt ein Element auf. Beim Verschieben Einrasten an Kanten/Mitten anderer Elemente, der Seitenmitte und am Raster (Hilfslinien, Alt = aus). Pfeiltasten: 1 px, mit Umschalt ein Rasterschritt. Ecken skalieren, Drehgriff.
- **Medien:** Bilder (Einfügen, Drag & Drop, Screenshot-Ausschnitt), Dateianhänge, PDF-Import als Hintergrundseiten (A4). Im endlosen Modus (Drag & Drop oder Einfügen-Menü) wird jede PDF-Seite ein freies, verschiebbares, skalierbares und beschreibbares Element mit derselben scharfen Rendering-Pipeline.
- **Undo/Redo:** Befehls-Stack, unbegrenzt pro Sitzung.
- **Gesten:** 2 Finger Zoom/Pan, 2-Finger-Tipp Undo, 3-Finger-Tipp Redo.

### 4.2 Blatt-Titel
- Kein Titelbalken auf dem Blatt: der Canvas beginnt direkt oben. Speicherstatus, Versionen, Ink-Wiedergabe und Blatt-Aktionen (Export, Vorlage, Erstellt/Geändert) sitzen in einer kleinen Leiste oben rechts (Linkshänder: links).
- **Umbenennen** nur in der Seitenleiste: Doppelklick/Doppeltipp auf den Namen → Inline-Eingabe (Enter oder Klick daneben speichert, Esc bricht ab), Kontextmenü „Umbenennen“, Taste **F2** für das offene Blatt.
- **Automatischer Titel** (`titleSource = "auto"`): neues Blatt heißt „Unbenannt“. Nach jedem Speichern (2 s Verzögerung) werden die ersten 3 Wörter genommen – zuerst aus Textcontainern in Lesereihenfolge (oben links → unten rechts), sonst aus erkannter Handschrift (InkAnalyzer, im Hintergrund). Satzzeichen am Ende entfernt, max. 40 Zeichen. Leeres Blatt → wieder „Unbenannt“. Inhalt ohne lesbaren Text lässt den Titel unverändert.
- Manuell vergebene Namen (`"manual"`) werden nie automatisch überschrieben; Kontextmenü „Automatischen Titel wiederherstellen“. Automatische Titel erscheinen in der Seitenleiste grau-kursiv.
- Migration 0009: bestehende Blätter mit Titel → `manual`, leere → `auto` + „Unbenannt“.

## 5. OneNote-Funktionen
Unterseiten, Drag & Drop-Sortierung, Tags (To-Do, Wichtig, Frage, Lernen für KA, eigene) mit Tag-Übersicht, Seitenlinks `[[…]]`, Volltextsuche (Text + erkannte Handschrift + OCR), Seitenvorlagen, Seitenversionen, Papierkorb, Ink-Wiedergabe, PDF-Export (Blatt/Thema/Fach), Drucken.

## 6. KI-/Erkennungsfunktionen (lokal bevorzugt)
- **Handschrift → Text / Suche:** Windows.UI.Input.Inking `InkAnalyzer` über Rust-WinRT-Bindings (offline, Deutsch).
- **Ink → LaTeX:** Formel per Lasso markieren → LaTeX (Modell z. B. lokal via ONNX, Fallback Online-API), Anzeige mit KaTeX.
- **OCR in Bildern:** `Windows.Media.Ocr` (offline, Deutsch).

## 7. UI / Design
- shadcn/ui, Hell + Dunkel + System; Akzentfarbe = Fachfarbe.
- Stiftoptimiert: Touch-Ziele ≥ 44 px, schwebende andockbare Werkzeugleiste, Radialmenü (Stifttaste / Long-Press), Linkshänder-Modus, Fokusmodus.
- Dunkler Canvas: Seite dunkel, Tinte intelligent invertiert (Luminanz-Inversion, Farbton bleibt), gespeichert wird Originalfarbe.
- **Logo:** `assets/logo.svg` (Notizblatt + Federspitze + Funke), daraus alle App-Icons (`pnpm tauri icon assets/logo.svg`); in Fenster/Taskleiste, Onboarding, Startseite, Spitz-Hinweisen.
- **Stiftleiste konfigurierbar:** Bearbeiten-Modus („Leiste anpassen“) mit Werkzeug-Ablage – Elemente per Ziehen hinzufügen, entfernen, umsortieren (Stift, Finger, Maus); Presets anlegen/bearbeiten/löschen (Typ, Farbe, Breite, Deckkraft; Rechtsklick/langes Drücken auf ein Preset); Ausrichtung horizontal/vertikal; oben, links, rechts angedockt oder frei schwebend; Größe klein/mittel/groß (Touch-Ziele ≥ 44 px); „Zurücksetzen“. Gespeichert gerätelokal.
- **Bedienung:** Alle Icon-Buttons mit Tooltip (Name + Tastenkürzel). Einheitliche Kontextmenüs per Rechtsklick/langem Drücken auf Fach, Thema, Blatt und Element (Bild/PDF → Auswahlmenü, Text → Greifbalken). Leere Zustände mit Erklärung + Aktion. Einstellungen in Kategorien (Darstellung, Stift & Bedienung, Erinnerungen, Sync, Sicherung) mit Suchfeld. Befehlspalette **Strg+K** (Suche: Strg+F). Helfer „Spitz“: kurzer, abschaltbarer Tipp beim ersten Benutzen eines Werkzeugs. Begriffe überall: **Fach → Thema → Blatt** (Unterblatt).
- **Screens:** Startseite (Fächer-Kacheln, heutiger Stundenplan, nächste Klassenarbeiten mit Countdown, zuletzt bearbeitet), Fach-Ansicht (Sidebar Theman/Blätter + Canvas), Kalender (Monat/Woche mit Stundenplan), Suche, Einstellungen.

### Onboarding (Pflicht beim ersten Start)
Vollbild-Assistent mit Fortschrittsanzeige, Zurück/Weiter, fortsetzbar (Schritt wird gespeichert); optionale Schritte haben „Überspringen“; erneut startbar unter Einstellungen → Bedienung.
1. Willkommen + Design (Hell/Dunkel/System, Akzentfarbe) · 2. Speicherort (Standard `Dokumente\Noteforge`, Ordnerdialog, Schreibrechte-Prüfung, Warnung bei OneDrive/Nextcloud/Dropbox-Ordnern; DB wird per `VACUUM INTO` kopiert, wirksam nach Neustart; Pfad in `location.json` im App-Konfigurationsordner) · 3. Stift & Hand (Rechts-/Linkshänder, Testfeld, Druck-Kalibrierung = Maximaldruck, Druckkurve weich/normal/fest, Stifttaste: Lasso/Radierer/Radialmenü) · 4. Standard-Blatt (endlos/A4; kariert 5 mm, liniert 8 mm, punktiert, leer) · 5. WebUntis (Schulsuche über die öffentliche WebUntis-Schulsuche, Login, Verbindungstest, Fächer anlegen + verknüpfen nach Bestätigung) · 6. Moodle · 7. Nextcloud (Testverbindung) · 8. OneNote-Import (OneNote-PDF-Export → je Datei ein A4-Blatt in Thema „OneNote-Import“) · 9. Erinnerungen an/aus (`app.reminders`), Vorlaufzeit sonstiger Termine, Benachrichtigungen erlauben, Helfer „Spitz“ (Werkzeug-Tipps) · 10. Zusammenfassung.

## 8. Integrationen
- **WebUntis:** inoffizielle JSON-RPC-API (`/WebUntis/jsonrpc.do?school=…`), Login Schulname/Benutzer/Passwort, Stundenplan + Vertretungen + Ausfälle, Cache in SQLite, Fach-Mapping. „Aktuelle Stunde öffnen“ springt ins Fach.
  - **Freistunden:** Lücken > 25 min zwischen stattfindenden Stunden („Lücke“) und entfallene Stunden zwischen zwei stattfindenden („Entfall“) werden in Startseite und Kalender-Woche als „Freistunde“ gezeigt (eigene Farbe, Streifenmuster; Entfall dichter gestreift). Lücken/Entfall vor der ersten bzw. nach der letzten Stunde sind keine Freistunden (Entfall bleibt als „entfällt“ sichtbar).
- **Moodle BW:** Token über `/login/token.php?service=moodle_mobile_app`, Webservice-Funktionen `core_enrol_get_users_courses`, `core_course_get_contents`, `core_calendar_get_action_events_by_timesort`; PDFs als Blatt importieren.
- Zugangsdaten im Windows Credential Manager.

## 9. Sync
Datenordner (SQLite + Blobs) mit Nextcloud über WebDAV; Konflikte pro Blatt (neuere Version gewinnt, ältere als PageVersion erhalten). Automatisches lokales Backup täglich.

## 10. Phasen
0 Gerüst + Stift-Latenztest · 1 Struktur/DB/Startseite · 2 Canvas-Kern · 3 Werkzeuge · 4 OneNote-Funktionen · 5 Kalender · 6 WebUntis + Moodle · 7 Erkennung (Handschrift, LaTeX, OCR) · 8 Sync, Export, Feinschliff
