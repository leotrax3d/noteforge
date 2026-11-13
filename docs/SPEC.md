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

### 4.7 Objekte, Textfelder, Eingabe (v0.2.8)
- **Sperren:** Bilder, PDFs und Formen lassen sich über das Schloss im Auswahlmenü sperren. Gesperrte Elemente liegen fest im Hintergrund und werden beim Antippen, Lasso und Hover nicht mehr ausgewählt. Mit Maus/Finger (Stift: nur mit Lasso) erscheint oben rechts ein Schloss-Symbol; Antippen entsperrt das Element und wählt es aus.
- **OCR-Ergebnis:** Der erkannte Text erscheint zeilenweise. Jede Zeile hat einen eigenen Kopieren-Knopf; markierter Text lässt sich gezielt kopieren oder als Textfeld einfügen.
- **Textfelder:** Die ganze Kopfleiste verschiebt das Feld. Mit gedrückter Alt-Taste wird nicht am Raster bzw. an den Linien eingerastet. Ein Papierkorb in der Kopfleiste löscht das Feld, ebenso Entf, wenn es aktiv, aber nicht im Schreibmodus ist. Textfelder und Tabellen liegen immer eine Ebene über Bildern, PDFs und Formen, beim Zeichnen wie bei der Treffererkennung.
- **Werkzeugleiste in der Kopfzeile:** Die Werkzeugleiste lässt sich in die Kopfzeile ziehen, rechts neben den Fachnamen; alternativ unter Leiste anpassen → Position „Kopfzeile“. Dort belegt sie keinen Blattplatz. Im Fokusmodus fällt sie auf „Oben“ zurück.
- **Palm Rejection:** Touch wird ignoriert, solange der Stift aufliegt, in Reichweite schwebt oder vor weniger als 2,5 s benutzt wurde. Kontakte mit großer Fläche (≥ 48 px) gelten als Handballen, sofern der Stift in den letzten 15 s benutzt wurde (manche Touchscreens melden auch für Finger große Flächen). Setzt der erste Finger auf (`isPrimary`), wird hängengebliebener Touch-Zustand (verpasstes `pointerup`) verworfen. Ein einmal erkannter Handballen bleibt es bis zum Abheben und löst keine Zoom-/Pan-Geste aus. Setzt der Stift auf, während ein Handballen schon eine Aktion begonnen hat, wird diese verworfen und der Stift gewinnt. Auch Textfelder ignorieren den Handballen. Ausnahme: Ist der Stift nicht aufgesetzt (nur schwebend oder gerade abgehoben), zeichnet ein einzelner Finger zwar nicht, zwei Finger zoomen und verschieben aber sofort (z. B. beim Annotieren von PDFs).
- **Autosave ohne Ruckeln:** Speichern und Journal warten, bis kein Strich läuft (≥ 250 ms nach dem Absetzen). Die Schreib-Commands (`save_elements`, `journal_*`, `auto_version`) laufen asynchron im Thread-Pool statt auf dem Hauptthread, damit die Stifteingabe der WebView nie blockiert wird.

### 4.8 Tabellen und Textbearbeitung (v0.2.9)
- **Tabellengröße:** Einfügen → „Tabelle …“ öffnet eine Größenauswahl wie in LibreOffice/Word: ein 8 × 6-Raster (überfahren oder antippen) oder Zeilen/Spalten genau per Stepper (bis 100 × 20). Neue Tabellen werden 120 px je Spalte breit und die erste Zelle ist sofort aktiv.
- **Spaltenbreite:** Die Trennlinien zwischen Spalten lassen sich mit Maus, Stift und Finger ziehen; die Griffzone ist breiter als die Linie (Touch 24 px). Ein Doppelklick auf den Trenner stellt die optimale Breite ein. Gespeichert werden die Breiten als Anteile (`TableData.cols`, Summe 1). Fehlt der Wert, sind die Spalten gleich breit.
- **Touch:** Tippt ein Finger auf ein Textfeld oder eine Tabelle, wird es mit jedem Werkzeug bearbeitbar. Die Schreibmarke landet an der Tippstelle (Engine-Ereignis `onObjTap`). Die Palm Rejection gilt weiter.
- **Kontextmenü (Rechtsklick / langes Drücken)** in Textfeldern und Zellen, im Stil der übrigen Noteforge-Menüs (shadcn/Glas, Einträge ≥ 44 px, Tastenkürzel rechts):
  - Ausschneiden, Kopieren, Einfügen, Alles auswählen.
  - **Zeichen:** fett, kursiv, unterstrichen, durchgestrichen, hoch- und tiefgestellt; Schrift größer/kleiner; Formatierung entfernen.
  - **Farbe:** Textfarbe und Hervorheben (Textmarker).
  - **Absatz:** links, zentriert, rechts, Blocksatz; Einzug; Überschrift 1/2; normaler Text; Aufzählung; Nummerierung.
  - **Groß-/Kleinschreibung:** Satzanfang groß, klein, GROSS, Jedes Wort groß, umkehren. Ohne Markierung gilt das für das Wort an der Schreibmarke.
  - **Einfügen:** Datum, Uhrzeit, Trennlinie und Sonderzeichen (→ ≈ ≠ ≤ ≥ ± ° ² π Δ € § …).
  - **In Tabellen:**
    - Zeile oberhalb/unterhalb bzw. Spalte links/rechts einfügen.
    - Zeile, Spalte, Zeilen- oder Spalteninhalt oder die ganze Tabelle löschen.
    - Zeile nach oben/unten verschieben.
    - Spalten gleichmäßig verteilen oder optimale Breite.
    - Kopfzeile hervorheben ein/aus (`TableData.header`).
    - Nach der Spalte sortieren, auf- oder absteigend: Zahlen in deutscher Schreibweise numerisch, sonst alphabetisch. Die Kopfzeile bleibt oben, leere Zellen kommen ans Ende.
    - Zellhintergrund für eine Zelle, Zeile oder Spalte (`TableData.bg`, im Dunkelmodus abgeschwächt).
    - Summe der Zellen darüber (AutoSumme).
    - Tabelle in ein Textfeld umwandeln.
  - **In Textfeldern:** Breite automatisch anpassen ein/aus, in Tabelle umwandeln, Textfeld löschen.
- **Tastenkürzel wie in LibreOffice Writer:**
  - Strg+E / L / R / J: Ausrichtung.
  - Strg+D: durchgestrichen.
  - Strg+⇧+P / Strg+⇧+B: hoch- bzw. tiefgestellt.
  - Strg+] / Strg+[: Schrift größer bzw. kleiner.
  - Strg+M: Formatierung entfernen.
  - Strg+1 / 2 / 0: Überschrift 1, Überschrift 2, normaler Text.
  - In Tabellen: Tab / ⇧+Tab wechselt die Zelle; Tab in der letzten Zelle hängt eine neue Zeile an. Alt+↑/↓ verschiebt die Zeile.
- **Einfügen tabellarischer Text:** Wird tab-getrennter Text (z. B. aus Calc oder Excel) in ein leeres Textfeld eingefügt, entsteht eine Tabelle. Tab im Textfeld wandelt es um; Tab- oder Semikolon-getrennte Zeilen werden dabei zu Spalten.
- **Variable Textfelder wie in OneNote:** Neue Textfelder (`TextData.auto`) wachsen beim Tippen nach rechts (mindestens 120 px), ab 640 px bricht der Text um. Die Breite folgt dem Inhalt, auch nach Enter. Lange Wörter und URLs brechen um (`overflow-wrap: anywhere`) statt überzulaufen. Ändert man die Breite von Hand, ist sie fest; im Kontextmenü lässt sich das automatische Anpassen wieder einschalten. Bestehende Felder behalten ihre feste Breite.
- **Sanitizer:** Erlaubt zusätzlich `text-align`, `background-color` (Marker), `<strike>`, `<blockquote>` (Einzug), `<hr>` und `<font size>`. Alle anderen Stile (z. B. `url(…)`, `position`) werden verworfen.
- **Werkzeugleiste als Insel:** Außerhalb des Vollbilds sitzt die Werkzeugleiste standardmäßig als abgesetzte Pille („Dynamic Island“) mittig in der Kopfzeile: abgerundet, mit Rahmen und Schatten, getrennt von den übrigen Kopfzeilen-Elementen. Im Fokusmodus (Vollbild) wandert sie automatisch nach oben aufs Blatt. Gespeicherte Leisten mit Position „Oben“ werden einmalig auf „Kopfzeile“ umgestellt.

### 4.2 Blatt-Titel
- Kein Titelbalken auf dem Blatt: der Canvas beginnt direkt oben. Speicherstatus, Versionen, Ink-Wiedergabe und Blatt-Aktionen (Export, Vorlage, Erstellt/Geändert) sitzen in einer kleinen Leiste oben rechts (Linkshänder: links).
- **Umbenennen** nur in der Seitenleiste: Doppelklick/Doppeltipp auf den Namen → Inline-Eingabe (Enter oder Klick daneben speichert, Esc bricht ab), Kontextmenü „Umbenennen“, Taste **F2** für das offene Blatt.
- **Automatischer Titel** (`titleSource = "auto"`): neues Blatt heißt „Unbenannt“. Nach jedem Speichern (2 s Verzögerung) werden die ersten 3 Wörter genommen – zuerst aus Textcontainern in Lesereihenfolge (oben links → unten rechts), sonst aus erkannter Handschrift (InkAnalyzer, im Hintergrund). Satzzeichen am Ende entfernt, max. 40 Zeichen. Leeres Blatt → wieder „Unbenannt“. Inhalt ohne lesbaren Text lässt den Titel unverändert.
- Manuell vergebene Namen (`"manual"`) werden nie automatisch überschrieben; Kontextmenü „Automatischen Titel wiederherstellen“. Automatische Titel erscheinen in der Seitenleiste grau-kursiv.
- Migration 0009: bestehende Blätter mit Titel → `manual`, leere → `auto` + „Unbenannt“.

### 4.9 Alles anzeigen
- Knopf „Alles anzeigen“ (Gruppe Ansicht, neben Zoom) und Strg+1: Kamera auf die Begrenzung aller Inhalte (Striche, Textfelder, Bilder, PDF-Seiten, Tabellen) mit 48 px Rand.
- Höchstens 200 % Zoom bei wenig Inhalt; leeres Blatt → Startansicht (wie Strg+0).
- Weicher Übergang (~260 ms, Zoom logarithmisch); bei „Bewegung reduzieren“ sofort.
- Der Hell/Dunkel-Umschalter in den Kopfzeilen entfällt; das Design wird nur in den Einstellungen gewählt.

### 4.10 Handschrift / Schreibschrift
- Positionsglättung per 1€-Filter in Bildschirmpixeln (min. Grenzfrequenz 5 Hz, β 0,015): langsames Schreiben ohne Zittern, schnelle Schleifen und Verbindungsbögen ohne Nachziehen. perfect-freehand-`streamline` nur noch gering (≈ 0,1–0,2).
- Vorhersage (`getPredictedEvents`): nur ein Punkt, höchstens 4 px vor dem letzten echten – keine Überschwinger an Umkehrpunkten.
- Stift stillhalten öffnet kein Radialmenü mehr (Stifttaste/Finger dafür); fester Punkt oder „nachdenkender“ Stift verliert keine Tinte.
- Formerkennung per Halten am Strichende beim Stift erst nach 750 ms (Finger/Maus 500 ms), damit Pausen am Wortende Schrift nicht in Formen verwandeln.
- Druck-Ausdünnung reduziert (Füller 0,5, Bleistift 0,3): leichte Verbindungsstriche bleiben sichtbar.

### 4.11 Seite an Bildschirm anpassen
- Knopf „Seite an Bildschirm anpassen“ (neben Zoom, Strg+2): passt die Seite in Bildschirmmitte (DIN-A4-Seite oder importierte PDF-Seite) ganz ein; erneut drücken → Seitenbreite. Ohne Seiten wie „Alles anzeigen“. Animiert.
- Start-Zoom beim Öffnen: erste Seite (A4/PDF) auf Bildschirmbreite (höchstens 160 %), oberer Seitenrand sichtbar. Endlos-Blätter ohne PDF bleiben bei 100 %.

### 4.12 Greifen als Standard (wie OneNote)
- Jedes geöffnete Blatt (und jeder App-Start) beginnt mit dem Werkzeug **Greifen** (Taste H): Finger und Maus verschieben die Ansicht.
- Setzt der Stift auf, während Greifen aktiv ist, wird automatisch das zuletzt gewählte Stift-Werkzeug (`penTool`: Stift/Textmarker inkl. Stiftart, Radierer, Lasso, Füllen, Winkel, Laser, verschwindende Tinte) aktiv – auch in der Leiste. Stifttaste/Radierende behalten ihre eigene Funktion.
- **Tippen = Klicken:** Finger-Tipp und Mausklick lösen dieselbe Aktion aus: Textfeld/Tabelle → bearbeiten an der Tippstelle, Strich/Bild → auswählen, leere Stelle → neues Textfeld (bei bestehender Auswahl hebt der Tipp nur die Auswahl auf; über gesperrten Elementen erscheint das Schloss). Auswahl-Griffe lassen sich mit Finger und Maus ziehen.

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

### 7.1 Designschema „Glas“ (v0.2.5)
- Schalter „Glas-Effekt“, kombinierbar mit Hell/Dunkel („Glas hell“, „Glas dunkel“). Tokens: `--glass-bg`, `--glass-border`, `--glass-blur` (Standard 24 px), `--glass-saturate` (160 %), `--glass-highlight`, `--glass-shadow`, `--radius-glass` (24 px); Klasse `.glass-surface` bzw. `data-glass` am Element.
- Glas auf: Dialoge, Popover, Dropdown-/Kontextmenüs, Befehlspalette (Dialog), Hinweis-Toasts, Seitenleiste, obere Leisten, Stiftleiste, Auswahlmenü, Radialmenü, Spitz, Zoom-Schreibfeld, Rechner, Startseiten-Kacheln (große Rundung, Icon-Kreis in Fachfarbe, viel Innenabstand). Tooltips sind native `title`-Tooltips von Windows und bleiben unverändert. Das Blatt bleibt deckend.
- Hintergrund: Fenstermaterial Mica (Windows 11, Standard) bzw. Acrylic (Windows 10 oder auf Wunsch) über `window-vibrancy`, gesetzt in Rust vor dem Anzeigen (Einstellung `app.windowMaterial`); oder neutraler App-Hintergrund; optional eigenes Bild. **Keine farbigen Verläufe bzw. Farbglows.** Das eigene Bild wird beim Hochladen verkleinert und einmalig weichgezeichnet (`app.glassImage`), zur Laufzeit läuft kein Filter. Akzentfarbe optional aus dem Bild.
- Übergänge: Dialoge/Menüs mit Blur-In (180 ms, ease-out, Hintergrund leicht weichgezeichnet und abgedunkelt), Seitenwechsel als Überblendung, Kacheln hellen beim Hover auf und skalieren beim Drücken auf 0,98. `prefers-reduced-motion` und die Einstellung „Animationen reduzieren“ schalten das ab.
- Performance: Schwebende Flächen über dem Canvas (`data-glass-float`) haben eine eigene Compositing-Ebene (`will-change: transform`, `isolation`). Während des Schreibens verlieren sie den Blur (fester halbtransparenter Hintergrund) und bekommen ihn nach 0,7 s weich zurück, ohne React-Rendering. Im Akku-Leistungsmodus wird der Blur reduziert (8 px), behalten oder abgeschaltet (einstellbar). Ohne `backdrop-filter` wird es deckender (≥ 85 %). Messung: `docs/perf/glass-latency.log`.
- Barrierefreiheit: Die Deckkraft wird automatisch so weit erhöht, dass normaler und gedämpfter Text WCAG AA (≥ 4,5:1) erreichen. Bei Windows-„Transparenzeffekte aus“ (Registry `EnableTransparency`), `prefers-reduced-transparency`, Kontrastmodus (`forced-colors`) oder `prefers-contrast: more` bleibt Glas aus.
- Einstellungen → Darstellung: Glas-Schalter, Transparenz- und Blur-Regler mit Live-Vorschau, eigenes Bild, Fensterhintergrund Mica/Acrylic/aus, Akkuverhalten, „Animationen reduzieren“. Onboarding-Schritt „Design“: Glas mit Vorschau.

### Onboarding (Pflicht beim ersten Start)
Vollbild-Assistent mit Fortschrittsanzeige, Zurück/Weiter, fortsetzbar (Schritt wird gespeichert); optionale Schritte haben „Überspringen“; erneut startbar unter Einstellungen → Bedienung.
1. Willkommen + Design (Hell/Dunkel/System, Glas mit Vorschau, Akzentfarbe) · 2. Speicherort (Standard `Dokumente\Noteforge`, Ordnerdialog, Schreibrechte-Prüfung, Warnung bei OneDrive/Nextcloud/Dropbox-Ordnern; DB wird per `VACUUM INTO` kopiert, wirksam nach Neustart; Pfad in `location.json` im App-Konfigurationsordner) · 3. Stift & Hand (Rechts-/Linkshänder, Testfeld, Druck-Kalibrierung = Maximaldruck, Druckkurve weich/normal/fest, Stifttaste: Lasso/Radierer/Radialmenü) · 4. Standard-Blatt (endlos/A4; kariert 5 mm, liniert 8 mm, punktiert, leer) · 5. WebUntis (Schulsuche über die öffentliche WebUntis-Schulsuche, Login, Verbindungstest, Fächer anlegen + verknüpfen nach Bestätigung) · 6. Moodle · 7. Google Kalender (optional: Client-ID, Anmeldung, Zielkalender und Auswahl, was synchronisiert wird) · 8. Nextcloud (Testverbindung) · 9. OneNote-Import (OneNote-PDF-Export → je Datei ein A4-Blatt in Thema „OneNote-Import“) · 10. Erinnerungen an/aus (`app.reminders`), Vorlaufzeit sonstiger Termine, Benachrichtigungen erlauben, Helfer „Spitz“ (Werkzeug-Tipps) · 11. Zusammenfassung.

### 7.x Kopfzeile im GoodNotes-Stil
- Im Fach ist die Kopfzeile in der Fachfarbe eingefärbt; Symbole in Kontrastfarbe (schwarz/weiß je nach Helligkeit).
- Links: Startseite, Seitenleiste, Suche, Tags (Fachname nur auf sehr breiten Fenstern).
- Mitte: Werkzeuge (Position „Kopfzeile“, Standard). Füller/Kugelschreiber/Bleistift teilen sich ein Stift-Symbol; Gruppen durch Trennstriche abgesetzt.
- Rechts: Speicherstatus, Seitenversionen, Ink-Wiedergabe, Blatt-Menü, Fokusmodus.
- Darunter schwebend: Optionsleiste fürs aktive Werkzeug (Stift: Stiftart, 3 Breiten, Schnellfarben, „+“ für alle Farben/Breiten; Radierer: Modus und Größe), links Rückgängig/Wiederholen, rechts Zoom und „Alles anzeigen“ (Linkshänder: gespiegelt).
- Andere Positionen (oben, links, rechts, schwebend) und der Fokusmodus nutzen weiter die klassische Leiste.

- Vollbild (Fokusmodus): dieselbe flache Werkzeugleiste schwebt oben mittig. Tippen auf das aktive Stift-/Radierer-Symbol klappt die Optionsleiste darunter auf; nach einer Auswahl (Stiftart, Breite, Farbe, Radier-Modus/-Größe) oder einem Strich klappt sie wieder zu. Rückgängig/Wiederholen schwebt links.
- Seitenleiste mit Reitern wie GoodNotes: **Raster** (Miniaturen in Blattfarbe/-hintergrund je Thema), **Liste** (bisheriger Baum mit Ziehen/Ablegen), **Lesezeichen** (markierte Blätter). Lesezeichen über das Blatt-Menü (⋮); gespeichert in `page.bookmarked` (Migration 0013).

## 8. Integrationen
- **WebUntis:** inoffizielle JSON-RPC-API (`/WebUntis/jsonrpc.do?school=…`), Login Schulname/Benutzer/Passwort, Stundenplan + Vertretungen + Ausfälle, Cache in SQLite, Fach-Mapping. „Aktuelle Stunde öffnen“ springt ins Fach.
  - **Freistunden:** Lücken > 25 min zwischen stattfindenden Stunden („Lücke“) und entfallene Stunden zwischen zwei stattfindenden („Entfall“) werden in Startseite und Kalender-Woche als „Freistunde“ gezeigt (eigene Farbe, Streifenmuster; Entfall dichter gestreift). Lücken/Entfall vor der ersten bzw. nach der letzten Stunde sind keine Freistunden (Entfall bleibt als „entfällt“ sichtbar).
  - **Verlauf:** Vergangene Tage bleiben dauerhaft im Cache. Beim ersten Abgleich wird das laufende Schuljahr ab 1. August in 4-Wochen-Stücken nachgeladen; danach wird ab Montag der Vorwoche aktualisiert.
- **Offline-First (v0.2.6, §8.1):** Stundenplan, Prüfungen (REST `/api/exams`, sonst JSON-RPC `getExams` je Prüfungsart), Hausaufgaben (`/api/homeworks/lessons`) und Abwesenheiten (`/api/classreg/absences/students`) liegen in SQLite; alles bleibt ohne Netz nutzbar. Abgleich beim Start, alle 15 min und bei „online“. Gesperrte Endpunkte werden still übersprungen, der Cache bleibt.
  - **Netzzeit:** eine gemeinsame Uhr (`clock.rs`): Abweichung aus dem HTTP-`Date`-Kopf jeder Nextcloud-/WebUntis-Antwort (die Messung der Nextcloud-Sync-Fehlervermeidung wird mitgenutzt) plus Probe an die eingerichteten Server alle 5 min; genaueste Messung (kleinste Laufzeit) der letzten 10 min gilt, letzter Wert gespeichert. Aktive Stunde, Pausen, Hinweise und Erinnerungen nutzen sie.
  - **Aktives Fach:** läuft eine Stunde, steht ihr Fach in „Meine Fächer“ an erster Stelle (nur Anzeige) mit Rahmen und „Jetzt“-Plakette. Einstellung „Aktuelles Fach automatisch öffnen“ (Stift & Bedienung, Standard aus): einmal pro Stunde, nur von der Startseite.
  - **Pausen-Banner:** 5-Minuten-, 10-Minuten-, Große Pause (bis 25 min) und Mittagspause (40–100 min, Beginn 11:15–14:15; zählt nicht als Freistunde, eigene Karte „Mittag“) mit Restzeit und nächster Stunde.
  - **Hausaufgaben:** WebUntis-Aufgaben (`untis:<id>`) wie Moodle-Abgaben (Titel/Frist von dort, Erledigt/Notiz lokal). Offene Aufgabe in der nächsten stattfindenden Stunde des Fachs fällig → Plakette „Fällig in der nächsten Stunde“ und Banner auf der Startseite. Entfallen am Fälligkeitstag alle Stunden des Fachs → „Stunde fällt aus“.
    - **Anzeige (v0.2.16):** Fach als farbiges Label; Titel = erste Textzeile, bei Überlänge am Wortende mit „…“ gekürzt (max. 90 Zeichen) und in der Liste höchstens zweizeilig, nie mitten im Wort abgeschnitten. Die Beschreibung zeigt nur, was über den Titel hinausgeht; der vollständige Text (inkl. WebUntis-Bemerkung) klappt per Pfeil auf. Metadaten: WebUntis-Fach, Fälligkeit, Ausgabedatum, Lehrkraft (Spalten `untis_subject`, `assigned_at`, `teacher`, Migration 0014; synchronisiert wie die übrige Zeile).
  - **Fach-Zuordnung (v0.2.16):** Dialog „Fächer zuordnen“ (Konten, Notenseite oder jedes „Nicht zugeordnet“-Label) listet die WebUntis-Fächer mit je einem Noteforge-Fach. Vorschläge über Lang-/Kurznamen und eindeutige Kürzel („PH“ → Physik) werden erst per „Vorschlag übernehmen“ bzw. „Alle Vorschläge übernehmen“ gesetzt und mit „Speichern“ bestätigt; „+ Neues Fach … anlegen“ erstellt das Noteforge-Fach direkt. Gespeichert in `subject.webuntis_subject_id` (offline, per Sync auf alle Geräte; ein Noteforge-Fach je WebUntis-Fach). Beim Speichern hängt `set_untis_mapping` vorhandene WebUntis-Hausaufgaben und -Prüfungen ohne Fach oder mit dem bisher zugeordneten Fach um (von Hand gewählte Fächer bleiben) und legt ausstehende Noten nach. Ohne Zuordnung: Stunden, Hausaufgaben und Prüfungen zeigen „Nicht zugeordnet“ und öffnen per Tipp den Dialog am passenden Fach; die Notenseite weist auf nicht zugeordnete Fächer hin.
  - **Arbeiten & Tests:** WebUntis-Prüfungen werden Termine (Quelle `webuntis`, `untis-exam:<id>`, Erinnerung am Vortag, Titel/Zeit nur lesend); eigene Kalendertermine vom Typ Klassenarbeit/Test erscheinen in derselben Liste („Eigener Termin“). Banner „Morgen: …“. Nach Ende einer Arbeit ohne überlappende Abwesenheit legt Noteforge im Notentab einen Eintrag „Ausstehend“ an (`grade.status='pending'`, ID `pending:<Schlüssel>`, gilt für Arbeiten ab Einführung −14 Tage); „Note eintragen“ macht daraus eine normale Note, Entfernen verwirft ihn dauerhaft (`skipped`). Ausstehende zählen nicht im Schnitt.
  - **Stundenplan-Ansichtsmenü:** „Heute ▾“ (Heute / Morgen / Woche im Kalender) mit Dots: rot = Ausfälle, grün = Freistunden, gelb = Vertretungen, jeweils Anzahl heute + morgen (`ScheduleDots`, auch an anderen Menüs einsetzbar).
  - Schema 12: `event.source` und `homework.source` + `webuntis`, `grade.value` nullable + `status`/`exam_key`, Tabelle `untis_absence`. Ältere App-Versionen können ausstehende Noten aus dem Nextcloud-Sync nicht übernehmen.
- **Moodle BW:** Schul-Login (Schule@BW/Keycloak, `typeoflogin` 2/3 laut `tool_mobile_get_public_config`): eigenes Fenster mit `/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=…&urlscheme=moodlemobile`; die Umleitung auf `moodlemobile://token=…` wird abgefangen, Signatur md5(wwwroot+passport) geprüft, nur das Token landet im Credential Manager. Sonst Token über `/login/token.php?service=moodle_mobile_app`, Webservice-Funktionen `core_enrol_get_users_courses`, `core_course_get_contents`, `core_calendar_get_action_events_by_timesort`; PDFs als Blatt importieren.
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

## 15. Bug-Reports (v0.2.16)

- **App:** Startseite → „Bug melden“ (immer beschriftet, auf schmalen Fenstern nur Symbol mit Screenreader-Text). Dialog mit Textfeld (10–5000 Zeichen, Zähler), „Absenden“, danach Erfolgs- oder deutsche Fehlermeldung (keine Verbindung, nicht eingerichtet, Server/Berechtigung). Mitgesendet werden nur App-Version und Betriebssystem/Architektur – keine Konto- oder Gerätedaten.
- **Übertragung:** Tauri-Befehl `submit_bug_report` (Rust, `feedback.rs`) schickt per PostgREST `INSERT` mit `Prefer: return=minimal`. Projekt-URL und **anon**-Schlüssel kommen beim Bauen aus `NOTEFORGE_SUPABASE_URL` / `NOTEFORGE_SUPABASE_ANON_KEY` (GitHub-Repository-Variablen). Der anon-Schlüssel ist öffentlich; ein `service_role`-Schlüssel kommt nie in App oder Dashboard. Ohne Konfiguration meldet der Dialog „nicht eingerichtet“. Höchstens ein Bericht pro 30 s.
- **Datenbank:** `supabase/migrations/20261113150000_bug_reports.sql` – Tabelle `bug_reports` (id, created_at, updated_at, description, status `open|in_progress|done`, app_version, platform), Tabelle `admins` (user_id → auth.users), Funktion `is_admin()`.
- **RLS/Rechte:** anon und angemeldete Nutzer dürfen nur einfügen (Spaltenrechte nur auf description/app_version/platform, Status immer „open“) und nichts lesen, ändern oder löschen. Nur Nutzer in `admins` lesen alle Berichte, ändern ausschließlich `status` und löschen. Niemand kann sich selbst zum Admin machen. Tests: `supabase/tests/run.sh` (Wegwerf-Postgres mit Supabase-Stub).
- **Admin-Dashboard:** `admin/index.html` (statische Seite, nicht Teil der App; Supabase-Auth mit E-Mail/Passwort, Werte in `admin/config.js`). Zähler-Kacheln als Statusfilter, Volltextsuche, Status je Bericht ändern, Löschen mit Rückfrage, Hell/Dunkel, ab 390 px nutzbar. Berichtstexte werden nur als Text eingesetzt (kein HTML). Einrichtung: `docs/BUG-REPORTS.md`.
