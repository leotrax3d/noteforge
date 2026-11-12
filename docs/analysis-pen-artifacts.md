# Analyse: Stift-Artefakte bei kleiner Schrift

Befund im Eingabe-/Render-Pfad (`src/canvas/core/engine.ts`, `pens.ts`) vor der Korrektur:

1. **Fast identische Punkte.** Gefiltert wurden nur *exakt* gleiche Koordinaten. Bei kleiner,
   langsamer Schrift liefern `getCoalescedEvents()` (Stift ≈ 240 Hz) viele Punkte mit
   Abständen < 0,1 px. perfect-freehand berechnet Richtung und Normalen aus diesen Mini-Segmenten;
   kleine Messfehler kippen die Normale → Zacken, „Haare“ und Knoten im Umriss. **Hauptursache.**
2. **Druckspitzen an Anfang/Ende.** Das erste Pen-Event hat oft Druck 0 (→ Ersatzwert 0,3) oder
   springt; beim Abheben fällt der Druck in 1–2 Events auf ~0. Mit `thinning 0.65` und Breite 1,5
   ergibt das Breiten nahe 0 → eingeschnürte Kleckse und sich selbst schneidende Polygone.
3. **Ungeglätteter Druck.** Rohdruck schwankt von Event zu Event; bei dünnen Strichen sichtbar
   als „perlende“ Kontur.
4. **Sehr kurze Striche** (i-Punkte, Kommas: 1–3 Punkte) erzeugen in perfect-freehand ein
   entartetes Polygon (Sichel/Splitter statt Punkt).
5. **Parameter für große Schrift.** `thinning` war unabhängig von der Breite; dünne Stifte
   verlieren dadurch überproportional Breite.
6. **Vorhersagepunkte** wurden zwar je Event neu gesetzt, blieben aber bis zum nächsten
   *Move* im Live-Strich; beim Abheben sah man kurz den „überschießenden“ Teil. Jetzt werden sie
   nach jedem Frame verworfen und nie übernommen.

Keine Ursache: Rundung (Weltkoordinaten bleiben Float), DPR (Canvas ist in Gerätepixeln),
Füllregel (Canvas-Standard „nonzero“ – jetzt explizit gesetzt).

Korrektur: `src/canvas/core/ink-filter.ts` (Mindestabstand 0,3 px Bildschirm → Welt,
gleitender Druck-Mittelwert über 4 Punkte, Spitzen-Kappung Anfang/Ende, breitenabhängige
Parameter, Punkt/Kapsel für kurze Striche). Debug-Ansicht: **Strg+Umschalt+D**.

# Analyse: Glitches beim Start

1. **Weißes Fenster vor dem Laden.** Tauri zeigte das Fenster sofort; WebView2 malt bis zum
   ersten HTML-Frame mit Weiß (Standard-Hintergrund) → heller Blitz, besonders im Dunkelmodus.
2. **Theme erst nach React-Mount.** Die Klasse `dark` wurde im `useEffect` des ThemeProviders
   gesetzt, also *nach* dem ersten Commit/Paint → ein Frame hell, dann dunkel.
3. **Layout vor erster Messung.** Die Canvas-Ebenen haben bis zum ersten `ResizeObserver`-Aufruf
   0×0 px; die Kopfzeile springt kurz. Schriften: es werden Systemschriften verwendet (keine
   Webfonts), daher kein FOUT – trotzdem wird `document.fonts.ready` (max. 300 ms) abgewartet.

Korrektur: Fenster `visible: false` + dunkle `backgroundColor`; Inline-Skript in `index.html`
setzt Theme-Klasse und Hintergrund vor jedem CSS/JS; `main.tsx` zeigt das Fenster nach dem ersten
fertigen Frame (doppeltes `requestAnimationFrame`) und passt die Fensterfarbe an; Rust zeigt es
spätestens nach 4 s als Sicherheitsnetz.
