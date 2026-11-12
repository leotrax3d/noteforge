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

### 4.3 Formen, Pfeile, Füllen, Messen, Zoom-Schreibfeld, Laser
- **Vektor-Elemente:** Bild-Element (`image`) mit `data.vec` (Spezifikation) und gerendertem SVG/PNG in `src`. Damit gelten Lasso, Verschieben, Skalieren, Drehen, Farbe, Undo und Sync unverändert; die Spezifikation macht sie bearbeitbar. Im Dunkelmodus Helligkeit invertiert (Farbton bleibt). Zeichenreihenfolge: PDF-Seiten → Füllungen → übrige Bilder → Tinte.
- **Formen-Bibliothek** (Taste **S**, Stiftleiste): Mathe – Koordinatensystem (x/y-Bereich, Schritt, Kästchen je Einheit, Raster, Beschriftung, Achsennamen; Ursprung rastet am Karo ein), Zahlenstrahl; Physik – Schaltzeichen (Widerstand, Lampe, Batterie, Schalter, Spannungs-/Strommessgerät, Diode, Kondensator) mit Anschlüssen, an denen Linien (Freihand → Linie, Lineal) einrasten (16 px); Chemie – Becherglas, Erlenmeyerkolben, Reagenzglas, Bunsenbrenner, Einfach-/Doppel-/Dreifachbindung; Musik – Notenlinien (Länge, Abstand, Violinschlüssel). Einstellbare Vorlagen nachträglich über Auswahlmenü „Form bearbeiten“. **Eigene Formen:** Lasso-Auswahl → „Als Vorlage speichern“ (Tabelle `shape_template`, Migration 0010; Kategorie „Eigene“).
- **Pfeilspitzen** (Anfang/Ende: keine, Pfeil, gefüllt, Vektorpfeil, Punkt) in der Stiftleiste. Gilt für am Lineal gezogene Geraden und Freihand → Linie; ein erkannter Pfeil wird zur Vektorlinie mit Spitze. Nachträglich per Lasso (Vektorlinien und gerade Striche).
- **Füllen** (Taste **F**): Tipp in eine geschlossene Form/einen Freihandbereich füllt ihn mit der Stiftfarbe (Deckkraft einstellbar) oder Schraffur (0/45/90/135°, 2–8 mm). Rasterbasierte Flutfüllung (Fenster wächst bis zum Inhalt), Begrenzungen um 2 mm verbreitert → Lücken bis 2 mm werden überbrückt; Füllung unter der Linie, als eigenes Element unter der Tinte. Offener Bereich → Hinweis.
- **Winkel messen** (Taste **W**): drei Punkte (Schenkel – Scheitel – Schenkel) oder zwei Linien antippen (Vektorlinien oder gerade Striche; Scheitel = Schnittpunkt, Schenkel zur angetippten Seite). Live-Anzeige mit Bogen und Gradzahl; „Als Beschriftung einfügen“ erzeugt Winkelbogen + Gradzahl (90° als Quadrat mit Punkt). Punkte rasten an Lineal-/Geodreieck-Kanten ein.
- **Zoom-Schreibfeld** (Taste **Z**): Feld unten (210 px), Vergrößerung 2–6×; Rahmen auf dem Blatt zeigt die Zielstelle und ist ziehbar. Striche werden verkleinert eingefügt (je Strich ein Undo-Schritt). Ist das rechte Drittel beschrieben, rückt der Rahmen nach rechts; am Zeilenende (A4: Seitenrand 15 mm, endlos: 18 cm) springt er in die nächste Linie/Karozeile. Eigene Glättung für kleine Schrift (Mindestabstand + 1-2-1-Mittelung).
- **Laserpointer** (Taste **P**): leuchtender Punkt mit 300-ms-Spur, nichts wird gespeichert. **Verschwindende Tinte** (Taste **V**): Striche blenden nach 1/2/4/8 s aus (Standard 2 s), nichts wird gespeichert. Beide auch im Radialmenü.
- Alle neuen Werkzeuge sind Elemente der konfigurierbaren Stiftleiste (Tooltips mit Tastenkürzel).

### 4.4 Strukturformel (Chemie)
- **Aufruf**: Stiftleiste → Einfügen → „Strukturformel …“ (Molekül-Symbol), Befehlspalette (Strg+K, „Strukturformel“), Formen-Bibliothek → Chemie.
- **Editor** (fast Vollbild): Zeichenmodus „Skelettformel“ (Zickzack, C/H implizit, 120°-Raster) oder „Volle Strukturformel“ (rechtwinklig, H sichtbar); das Molekül ist in beiden Modi dasselbe. Ziehen erzeugt eine Kette (jedes Segment ein C-Atom), Ziehen von einem Atom aus einen Ast, Ziehen auf ein vorhandenes Atom schließt einen Ring. Atom antippen → Radialmenü (C, H, O, N, S, Cl, Br, I, F, P, B, Si, Löschen); Bindung antippen → Einfach/Doppel/Dreifach. Seitenleiste mit funktionellen Gruppen (–OH, –CHO, –CO–, –COOH, –COO–, –NH₂, Halogene, Benzolring) zum Anhängen am markierten Atom. H nach Wertigkeit automatisch, Valenzfehler rot mit Tooltip und Hinweis in der Infozeile. Radierer, Rückgängig/Wiederholen (Strg+Z/Y), Zoom (Tasten/Mausrad), „Aufräumen“ (2D-Layout von OpenChemLib). Infozeile: Summenformel und Molmasse (OpenChemLib).
- **Darstellungen** (Live-Vorschau, antippen wählt): ausführliche Strukturformel (alle Atome inkl. H, rechtwinklig wie im Schulbuch), Halbstrukturformel (z. B. H₃C–CH₂–OH), Skelettformel (Zickzack). Eigenes SVG-Rendering; Ringe werden in den ersten beiden Darstellungen in der gezeichneten Geometrie gezeigt.
- **Element im Blatt**: Bild-Element mit `data.mol = { molfile, view }` und gerendertem SVG als `src`. Doppeltipp oder Auswahlmenü → Editor; Auswahlmenü „Darstellung“ wechselt nachträglich (Lage, Drehung, Skalierung bleiben). Verschieben/Skalieren/Beschriften wie andere Elemente; im Dunkelmodus wie Vektor-Elemente invertiert, im PDF-Export schwarz auf weiß.

### 4.5 Bedienoberfläche (v0.2.2)
- Werkzeugleiste in Gruppen (Stifte, Radieren & Auswählen, Formen & Messen, Einfügen, Präsentieren, Verlauf, Ansicht); zugeklappt ein Symbol, die Gruppe des aktiven Werkzeugs klappt automatisch auf. Frei schwebend bleibt sie vollständig im Blatt.
- Möglichst wenig Text: keine erklärenden Untertitel oder Hinweise. Startseiten-Leiste nur mit Symbolen; Alt blendet Beschriftungen ein/aus.
- Kein natives Ziehen/Markieren in der Oberfläche; eigene Scrollleisten, Regler und Farbwähler statt Windows-Standardelementen.

### 4.6 Auswählen, Raster, Zeichenhilfen (v0.2.4)
- **Antippen wählt aus** (wie „Auswählen“ in OneNote): Lasso-Tipp sowie Finger- oder Maus-Tipp mit einem Zeichenwerkzeug wählen den obersten Strich bzw. die oberste Form oder das Bild unter dem Zeiger. Danach lässt es sich über die Griffe verschieben, skalieren und drehen. Nur wenn dort nichts liegt, entsteht ein Textfeld.
- **Finger/Maus mit Zeichenwerkzeug:** Ziehen verschiebt das Blatt; das gewählte Werkzeug bleibt aktiv. Abschaltbar unter Blatt-Einstellungen.
- **Am Raster einrasten** (Hilfsmittel): Ecken erkannter Formen, Kreismittelpunkt und Radius (ganze Rasterschritte), Lineal-Striche und das Verschieben der Zeichenhilfen springen auf das Blattraster. Auf linierten Blättern nur senkrecht.
- **Lineal/Geodreieck vergrößern:** Doppelpfeil-Griff, 1-cm-Schritte (Lineal 10–60 cm, Geodreieck 8–40 cm Hypotenuse). Die mm-Skala wird verlängert, nicht gestreckt.
- Aufgeklappte Werkzeuggruppen klappen beim Zeichnen animiert ein. Die Leiste weicht den Blatt-Aktionen aus.

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
1. Willkommen + Design (Hell/Dunkel/System, Akzentfarbe) · 2. Speicherort (Standard `Dokumente\Noteforge`, Ordnerdialog, Schreibrechte-Prüfung, Warnung bei OneDrive/Nextcloud/Dropbox-Ordnern; DB wird per `VACUUM INTO` kopiert, wirksam nach Neustart; Pfad in `location.json` im App-Konfigurationsordner) · 3. Stift & Hand (Rechts-/Linkshänder, Testfeld, Druck-Kalibrierung = Maximaldruck, Druckkurve weich/normal/fest, Stifttaste: Lasso/Radierer/Radialmenü) · 4. Standard-Blatt (endlos/A4; kariert 5 mm, liniert 8 mm, punktiert, leer) · 5. WebUntis (Schulsuche über die öffentliche WebUntis-Schulsuche, Login, Verbindungstest, Fächer anlegen + verknüpfen nach Bestätigung) · 6. Moodle · 7. Google Kalender (optional: Client-ID, Anmeldung, Zielkalender und Auswahl, was synchronisiert wird) · 8. Nextcloud (Testverbindung) · 9. OneNote-Import (OneNote-PDF-Export → je Datei ein A4-Blatt in Thema „OneNote-Import“) · 10. Erinnerungen an/aus (`app.reminders`), Vorlaufzeit sonstiger Termine, Benachrichtigungen erlauben, Helfer „Spitz“ (Werkzeug-Tipps) · 11. Zusammenfassung.

## 8. Integrationen
- **WebUntis:** inoffizielle JSON-RPC-API (`/WebUntis/jsonrpc.do?school=…`), Login Schulname/Benutzer/Passwort, Stundenplan + Vertretungen + Ausfälle, Cache in SQLite, Fach-Mapping. „Aktuelle Stunde öffnen“ springt ins Fach.
  - **Freistunden:** Lücken > 25 min zwischen stattfindenden Stunden („Lücke“) und entfallene Stunden zwischen zwei stattfindenden („Entfall“) werden in Startseite und Kalender-Woche als „Freistunde“ gezeigt (eigene Farbe, Streifenmuster; Entfall dichter gestreift). Lücken/Entfall vor der ersten bzw. nach der letzten Stunde sind keine Freistunden (Entfall bleibt als „entfällt“ sichtbar).
  - **Verlauf:** Vergangene Tage bleiben dauerhaft im Cache. Beim ersten Abgleich wird das laufende Schuljahr ab 1. August in 4-Wochen-Stücken nachgeladen; danach wird ab Montag der Vorwoche aktualisiert.
- **Moodle BW:** Token über `/login/token.php?service=moodle_mobile_app`, Webservice-Funktionen `core_enrol_get_users_courses`, `core_course_get_contents`, `core_calendar_get_action_events_by_timesort`; PDFs als Blatt importieren.
- Zugangsdaten im Windows Credential Manager.

### 8.3 Google Kalender
**Anmeldung**
- OAuth 2.0 für Desktop-Apps (RFC 8252): Authorization Code mit PKCE (S256), Loopback-Redirect `http://127.0.0.1:<zufälliger Port>`, Login im Standardbrowser, `access_type=offline`.
- Scopes: `calendar.events`, `calendar.readonly` und zusätzlich `calendar.app.created`, damit die App ihren eigenen Kalender anlegen darf.
- Client-ID (Typ „Desktop-App“) in Einstellungen → Google Kalender; Anleitung in der README. Die Client-ID liegt in SQLite, das Client-Secret im Credential Manager.
- Refresh-Token pro Konto im Credential Manager (`google:<E-Mail>`). Access-Tokens liegen nur im Speicher und werden automatisch erneuert, auch wenn Google das Refresh-Token rotiert.
- Mehrere Konten möglich. Abmelden widerruft das Token bei Google (`/revoke`), löscht es lokal und entfernt auf Wunsch die angelegten Termine.

**Noteforge → Google**
- Zielkalender pro Konto: eigener Kalender „Noteforge – Schule“ (empfohlen, wird angelegt bzw. wiederverwendet) oder ein beschreibbarer bestehender Kalender.
- Pro Typ abschaltbar:
  - Klassenarbeiten/Tests: „KA Mathe – Thema“ bzw. „Test Mathe – Thema“; ganztägig ohne Uhrzeit, sonst 45 min.
  - Sonstige Kalendertermine.
  - Hausaufgaben mit Fälligkeit (nur manuelle, offene): „HA Fach – Titel“, ganztägig oder optional zur passenden Unterrichtsstunde laut Fach-Mapping.
  - Moodle-Abgaben.
  - Stundenplan (Standard aus): Stunden mit Raum, Vertretungen, ausgefallene Stunden als „Entfällt: …“ und Lücken ab 30 min als „Freistunde“.
- Farbe: nächstliegende der 11 Google-Terminfarben zur Fachfarbe (gewichteter RGB-Abstand).
- Erinnerungen: die Noteforge-Erinnerung wird als Popup-Erinnerung übernommen, bei KA/Tests optional zusätzlich 7, 3 und 1 Tag vorher. Google erlaubt höchstens 5 Erinnerungen bis 4 Wochen vorher.
- Beschreibung: Notiz und Deep-Link `noteforge://page/<id>` (verknüpftes Blatt, wählbar im Termin-Dialog), sonst `noteforge://subject/<id>` bzw. `noteforge://calendar`/`homework`. Das Protokoll ist über `tauri-plugin-deep-link` registriert; mit `tauri-plugin-single-instance` übergibt ein zweiter Start den Link an die laufende App.
- Abgleich-Fenster: ab 30 Tagen in der Vergangenheit. Ältere, verknüpfte Termine bleiben in Google stehen. Wird ein Typ abgeschaltet oder ein Eintrag lokal gelöscht, löscht Noteforge den Google-Termin.

**Google → Noteforge**
- Wählbare Kalender des Kontos (Familie, Verein …) werden nur lesend im Noteforge-Kalender angezeigt, in der Farbe des Google-Kalenders. Fremde Termine im Zielkalender ebenso.
- Änderungen in Google an eigenen Kalenderterminen (Titel, Datum/Uhrzeit, Löschen) werden übernommen. Das Präfix „KA Mathe – “ wird dabei wieder entfernt.
- Hausaufgaben, Stundenplan und Moodle-Abgaben haben ihre eigene Quelle; Google-Änderungen daran werden bei der nächsten lokalen Änderung überschrieben. In Google gelöschte Einträge dieser Art legt Noteforge erst nach einer lokalen Änderung neu an.
- Optional erkennt Noteforge Klassenarbeiten in Google-Terminen: „KA“, „Klassenarbeit“, „Klausur“ ergeben eine Klassenarbeit; „Test“, „Lernkontrolle“ und „…test“ ergeben einen Test. Zusätzlich muss ein Fachname oder ein übliches Kürzel vorkommen. Der Vorschlag lässt sich übernehmen oder verwerfen. Liegt der Termin im Zielkalender, wird er selbst zum Noteforge-Termin, ohne Dublette.

**Technik**
- Tabellen `gcal_account`, `gcal_source`, `gcal_remote`, `gcal_link` und `event_history`, alle gerätelokal (nicht im Nextcloud-Sync). Neue Spalten `event.updated_at` und `event.page_id`.
- Zuordnung über `extendedProperties.private.noteforgeId` (`event:<id>`, `hw:<id>`, `lesson:<id>:<start>`, `free:<start>`) und `gcal_link`. Die Google-Termin-ID ist deterministisch (`nf` + SHA-256 aus Konto und Schlüssel, base32hex), damit ein Wiederholversuch nach Verbindungsabbruch keine Duplikate erzeugt.
- Inkrementeller Abruf mit `syncToken` (erster Abruf ab −60 Tagen, `singleEvents`, `showDeleted`). Bei 410 Gone wird vollständig neu geladen.
- Offline-Warteschlange: Soll-Zustand gegen den zuletzt übertragenen Inhalts-Hash in `gcal_link`. Was offline geändert wurde, bleibt ausstehend (Anzeige „n Änderungen warten“) und wird beim nächsten Abgleich übertragen. Höchstens 150 Schreibzugriffe pro Durchlauf.
- Konflikte: Die letzte Änderung gewinnt (`event.updated_at` gegen Google `updated`). Die unterlegene Version kommt in den Termin-Verlauf (`event_history`), sichtbar und wiederherstellbar im Termin-Dialog.
- Rate-Limits: Bei 429, 5xx und 403 mit `rateLimitExceeded`/`userRateLimitExceeded` wartet Noteforge exponentiell (1, 2, 4, 8 s plus Streuung, höchstens 5 Versuche).
- Polling: alle 5 min bei Fensterfokus, sonst alle 20 min, im Akku-Sparmodus jeweils dreifach. Beim Zurückkehren ins Fenster und bei „online“ wird nachgeholt. Nach dem Speichern oder Löschen eines Termins wird nach 4 s übertragen.
- Status in Einstellungen → Google Kalender: zuletzt synchronisiert, ausstehende Änderungen, letzter Fehler, Button „Jetzt synchronisieren“.
- Spitz bietet keine Lernplan-Einheiten an. Sobald es sie gibt, kommen sie als weiterer Typ dazu.

## 9. Sync
Datenordner (SQLite + Blobs) mit Nextcloud über WebDAV; Konflikte pro Blatt (neuere Version gewinnt, ältere als PageVersion erhalten). Automatische Sicherungen siehe §10.1.

## 10. Technik & Sicherheit
### 10.1 Automatische Sicherungen
- Täglich (Hintergrund-Thread, beim ersten Lauf des Tages) per `VACUUM INTO` als `noteforge-JJJJ-MM-TT.sqlite`; „Jetzt sichern“ legt zusätzlich eine mit Uhrzeit an.
- Ordner wählbar (Standard `<Datenordner>/backups`), Aufbewahrung einstellbar: Standard 7 tägliche, 4 wöchentliche, 6 monatliche (je Tag/ISO-Woche/Monat die neueste); Einstellung `app.backup`.
- Einstellungen → Sicherung: Liste, „Wiederherstellen …“ mit Vorschau. Die Vorschau zeigt den Baum Fach → Thema → Blatt mit Elementanzahl und Vergleich mit heute (unverändert, heute anders, fehlt heute) sowie ein Vorschaubild des Blatts.
- Wiederherstellen: **komplett** (alle Tabellen außer `setting`/`sync_*`) oder **ausgewählte Fächer/Blätter** (Upsert inkl. Elemente, Tags, Assets; fehlende Fächer/Themen werden angelegt). Ältere Sicherungen werden vorher auf das aktuelle Schema migriert. Vor jeder Wiederherstellung wird der aktuelle Stand als `noteforge-vor-wiederherstellung-…` gesichert, diese Kopie wird nie automatisch gelöscht.
### 10.2 Absturzschutz
- SQLite im WAL-Modus (`synchronous=NORMAL`).
- Write-Ahead-Journal `journal.ndjson` im Datenordner. Das Frontend schreibt nach jedem Strich (gebündelt 250 ms, spätestens alle 2,5 s) den ausstehenden Stand mit Sitzung und laufender Nummer, Rust schreibt per `fsync`. Nach erfolgreichem Speichern in SQLite folgt ein Commit-Eintrag; ist alles bestätigt, wird das Journal geleert. Verspätet eintreffende, schon bestätigte Stände werden verworfen.
- Beim Start werden unbestätigte Einträge übernommen. Eine halb geschriebene letzte Zeile wird ignoriert, gelöschte Blätter übersprungen. Danach erscheint der Hinweis „X Änderungen wiederhergestellt“. Getestet durch hartes Beenden eines Kindprozesses (SIGKILL/TerminateProcess) während des Schreibens.
### 10.3 Auto-Update
- Tauri-Updater mit signierten Paketen aus GitHub-Releases (`latest.json`). Schlüssel-Setup und Release-Ablauf stehen in `docs/RELEASE.md`. Der Updater ist nur in Release-Builds mit Konfiguration aktiv.
- Etwa 10 s nach dem Start (im Akkubetrieb 60 s) prüft die App im Hintergrund und zeigt dann den dezenten Knopf „Update verfügbar“. Dahinter liegt ein Dialog mit Changelog (Release-Text) und den Optionen „Jetzt installieren und neu starten“ oder „Beim Beenden installieren“.
- Der Workflow `release.yml` baut die Releases (NSIS/MSI), signiert sie und lädt sie hoch.
### 10.4 Leistungsmodus im Akkubetrieb
- Netz- bzw. Akkustatus kommt über die Battery Status API (WebView2). Einstellung: automatisch (im Akkubetrieb), immer an oder aus.
- Im Sparmodus sind CSS-Animationen und Übergänge (Spitz, Dialoge, Menüs) aus. Die Hintergrund-Erkennung (Handschrift/OCR für Suche und Auto-Titel) wartet viermal so lange, die Update-Prüfung später.
- Das Stift-Rendering (Canvas, rAF, Eingabefilter) ist nie betroffen.

## 11. Phasen
0 Gerüst + Stift-Latenztest · 1 Struktur/DB/Startseite · 2 Canvas-Kern · 3 Werkzeuge · 4 OneNote-Funktionen · 5 Kalender · 6 WebUntis + Moodle · 7 Erkennung (Handschrift, LaTeX, OCR) · 8 Sync, Export, Feinschliff
