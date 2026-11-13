import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, History, LayoutTemplate, MoreVertical, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NameDialog } from "@/components/common/dialogs";
import { useTheme } from "@/components/theme/theme-provider";
import { CanvasEngine, type SelectionInfo } from "@/canvas/core/engine";
import { elementToStroke, strokeToElement } from "@/canvas/core/codec";
import { uid, type Stroke } from "@/canvas/core/model";
import { elementToObj, makeObj, objToElement, type CanvasObj, type ImageObj, type TableObj, type TextObj } from "@/canvas/core/objects";
import type { Vec } from "@/canvas/core/geometry";
import { api, putAsset, saveExport } from "@/lib/api";
import type { ElementTag, Page, PagePatch, Section } from "@/lib/types";
import { A4_GAP } from "@/canvas/core/layout";
import { useTagStore } from "@/features/tags/tag-store";
import { VersionsDialog } from "@/features/pages/VersionsDialog";
import { firstFreeA4, layoutPdfPages, pdfToImages } from "@/features/pages/pdf-import";
import { InkReplay } from "./InkReplay";
import { exportPdf, pagesInScope, pdfFileName, type ExportScope } from "./export-pdf";
import type { TagAnchor } from "./objects/ObjectLayer";
import { Toolbar, type InsertKind } from "./Toolbar";
import { SelectionMenu } from "./SelectionMenu";
import { RadialMenu } from "./RadialMenu";
import { ScreenshotCrop } from "./ScreenshotCrop";
import { newTable } from "./objects/table-ops";
import { focusCell } from "./objects/TextMenu";
import { ObjectLayer } from "./objects/ObjectLayer";
import { FormatBar } from "./objects/FormatBar";
import { captureScreen, encodeImage, fileToImage, type LoadedImage } from "./objects/images";
import { PAGE_ACTIONS_SLOT, useTools } from "./tool-store";
import { createPortal } from "react-dom";
import { usePrefs } from "@/store/prefs";
import { useSetup } from "@/store/setup";
import { PerfOverlay } from "./PerfOverlay";
import { ZoomWriter } from "./ZoomWriter";
import { ShapeLibrary } from "@/features/shapes/ShapeLibrary";
import { MoleculeEditor } from "@/features/chem/MoleculeEditor";
import { fromMolfile, type MolData, type MolView } from "@/features/chem/mol";
import { molSvgUrl, renderMol, type MolSvg } from "@/features/chem/render";
import { decodeTemplate, encodeTemplate, shapesApi } from "@/features/shapes/shapes-api";
import { vecObj } from "@/canvas/vector/vec-obj";
import { fmtDeg, type VecSpec } from "@/canvas/vector/vec";
import { MM } from "@/canvas/core/layout";
import { SpitzHint } from "./SpitzHint";
import { measureMetrics, placeText, type FontMetrics } from "@/canvas/core/text-snap";

let metricsCache: FontMetrics | null = null;
const textMetrics = () => (metricsCache ??= measureMetrics(getComputedStyle(document.body).fontFamily || "sans-serif"));
import { readingOrder, titleFromText, titleFromTexts, UNTITLED } from "@/lib/auto-title";
import { backgroundDelayFactor, shouldThrottleBackground } from "@/lib/power";
import { cn } from "@/lib/utils";
import { journal } from "@/lib/journal";
import { recognition, dataUrlBytes, errText, UNAVAILABLE } from "@/lib/recognition";
import { inkToLatex } from "@/features/recognition/latex";
import { LatexDialog, type LatexRequest } from "@/features/recognition/LatexDialog";
import { OcrDialog, type OcrView } from "@/features/recognition/OcrDialog";
import { svgDataUrl, useCalc } from "@/features/calc/calc-store";
import type { PlotSpec } from "@/features/calc/plot";

type SaveState = "saved" | "pending" | "saving" | "error";
const SAVE_DELAY = 800;
const SAVE_MAX_WAIT = 5000;
/** Mindestabstand automatischer Seitenversionen. */
const VERSION_INTERVAL = 10 * 60_000;
/** Ruhezeit nach dem Speichern, bevor Handschrift/Bilder für die Suche erkannt werden. */
const RECOGNIZE_DELAY = 4000;
/** Auto-Titel aus Handschrift: 2 s nach dem letzten Strich (gespeichert) */
const AUTO_TITLE_DELAY = 2000;

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textHtml = (t: string) => t.split("\n").map((l) => `<div>${escapeHtml(l) || "<br>"}</div>`).join("");

/** Zeichenfläche eines Blatts: Engine + Werkzeugleiste + Autospeichern. */
export function CanvasView({ page, onAutoTitle, autoRev = 0, onPageChange, focus, onOpenLink, onPageReplaced, sections = [], pages = [], subjectName = "" }: {
  page: Page;
  /** Automatisch gebildeter Titel (nur bei titleSource "auto") */
  onAutoTitle?: (title: string) => void;
  /** Erhöhen → Auto-Titel sofort neu bilden ("Automatischen Titel wiederherstellen") */
  autoRev?: number;
  onPageChange: (patch: PagePatch) => void;
  /** Element, auf das nach dem Laden zentriert wird. */
  focus?: string;
  onOpenLink?: (title: string) => void;
  /** Inhalt wurde im Backend ersetzt (Version wiederhergestellt). */
  onPageReplaced?: () => void;
  sections?: Section[];
  pages?: Page[];
  subjectName?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  // Genau ein Funktionsgraph ausgewählt → im Plotter bearbeitbar
  const plotSel = useMemo(() => (sel?.count === 1 ? engineRef.current?.selectionInk()?.images[0]?.data.plot ?? null : null), [sel]);
  const [save, setSave] = useState<SaveState>("saved");
  const [loaded, setLoaded] = useState(false);
  const [objects, setObjects] = useState<CanvasObj[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  editingRef.current = editingId;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [radial, setRadial] = useState<Vec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [pageTags, setPageTags] = useState<ElementTag[]>([]);
  const [anchors, setAnchors] = useState<TagAnchor[]>([]);
  const [replay, setReplay] = useState(false);
  const [versions, setVersions] = useState(false);
  const [tplDialog, setTplDialog] = useState(false);
  const [shapes, setShapes] = useState<{ edit: VecSpec | null } | null>(null);
  /** Strukturformel-Editor: neu (an der Ansichtsmitte) oder Bearbeiten eines vorhandenen Elements */
  const [chem, setChem] = useState<{ edit: ImageObj | null } | null>(null);
  const lastDown = useRef<{ t: number; x: number; y: number } | null>(null);
  const [shapeTplName, setShapeTplName] = useState(false);
  const [angle, setAngle] = useState<{ deg: number; at: Vec } | null>(null);
  const zoomWrite = useTools((s) => s.zoomWrite);
  const [busy, setBusy] = useState<string | null>(null);
  const [latexReq, setLatexReq] = useState<(LatexRequest & { target?: TextObj }) | null>(null);
  const [ocrView, setOcrView] = useState<OcrView | null>(null);
  const recTimer = useRef(0);
  const tagsLoaded = useTagStore((s) => s.loaded);
  const loadTags = useTagStore((s) => s.load);
  const layerElRef = useRef<HTMLDivElement | null>(null);
  const tool = useTools((s) => s.tool);
  const { resolved } = useTheme();

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((flash as unknown as { t?: number }).t);
    (flash as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 1600);
  }, []);

  // ---- Autospeichern (entprellt, serialisiert) ----
  const saveRef = useRef({ timer: 0, first: 0, chain: Promise.resolve() as Promise<void> });
  const flush = useCallback(() => {
    const s = saveRef.current;
    clearTimeout(s.timer);
    s.timer = 0;
    s.first = 0;
    const engine = engineRef.current;
    if (!engine || !engine.store.hasPending) return s.chain;
    const batch = engine.store.takePending();
    // Journal: alles bis hierher Geschriebene ist nach erfolgreichem Speichern erledigt
    window.clearTimeout(jRef.current.timer);
    jRef.current.timer = 0;
    jRef.current.first = 0;
    const jSeq = journal.current();
    setSave("saving");
    s.chain = s.chain
      .then(() => api.saveElements(
        page.id,
        [...batch.upserts.map((x) => strokeToElement(x, page.id)), ...batch.objects.map((o) => objToElement(o, page.id))],
        batch.deletes,
      ))
      .then(() => {
        void journal.commit(page.id, jSeq).catch(console.error);
        setSave(engine.store.hasPending ? "pending" : "saved");
        // Erkennung für die Suche (Handschrift + OCR) im Hintergrund, erst nach einer Ruhepause
        clearTimeout(recTimer.current);
        const pid = page.id;
        recTimer.current = window.setTimeout(() => void recognition.recognizePage(pid).catch(console.error), RECOGNIZE_DELAY * backgroundDelayFactor());
        autoTitleSoon.current();
        if (batch.deletes.length) {
          const gone = new Set(batch.deletes);
          setPageTags((t) => (t.some((x) => gone.has(x.elementId)) ? t.filter((x) => !gone.has(x.elementId)) : t));
        }
      })
      .catch((err) => {
        console.error("Speichern fehlgeschlagen", err);
        engine.store.restorePending(batch);
        setSave("error");
      });
    return s.chain;
  }, [page.id]);

  // ---- Automatischer Titel (SPEC §4.2): Text zuerst, sonst Handschrift 2 s nach dem letzten Strich ----
  const autoTitleSoon = useRef<() => void>(() => {});
  const autoTimer = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  const autoRef = useRef(onAutoTitle);
  autoRef.current = onAutoTitle;
  autoTitleSoon.current = () => {
    window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(() => void computeAutoTitle(), AUTO_TITLE_DELAY);
  };
  const computeAutoTitle = async () => {
    const engine = engineRef.current, pg = pageRef.current;
    if (!engine || pg.titleSource !== "auto" || !autoRef.current) return;
    const texts = engine.store.objects().filter((o): o is TextObj => o.kind === "text")
      .map((o) => ({ bbox: o.bbox, html: o.data.html, latex: o.data.latex }));
    let t = titleFromTexts(texts);
    const strokes = engine.store.all();
    if (!t && strokes.length) {
      // Handschrift: nur die oberste Zeile(n) – die ersten Striche in Lesereihenfolge reichen für 3 Wörter
      const first = readingOrder(strokes.filter((x) => x.pen !== "highlighter")).slice(0, 80);
      try {
        if (shouldThrottleBackground()) await new Promise((r) => setTimeout(r, 4000));
        const r = await recognition.recognizeStrokes(first.map((x) => x.points));
        t = titleFromText(r.text);
      } catch {
        return; // keine Erkennung verfügbar → Titel bleibt
      }
    }
    if (!t && (strokes.length || engine.store.objects().length)) return; // Inhalt ohne lesbaren Text: Titel behalten
    const next = t || UNTITLED;
    if (pageRef.current.titleSource === "auto" && next !== pageRef.current.title) autoRef.current?.(next);
  };
  useEffect(() => { if (autoRev) void computeAutoTitle(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [autoRev]);

  // ---- Write-Ahead-Journal: gebündelt nach jedem Strich (250 ms), spätestens alle 2,5 s ----
  const jRef = useRef({ timer: 0, first: 0, seq: 0 });
  const journalSoon = useCallback(() => {
    const j = jRef.current, now = Date.now();
    if (!j.first) j.first = now;
    window.clearTimeout(j.timer);
    const run = () => {
      const engine = engineRef.current;
      if (engine?.inputActive) { j.timer = window.setTimeout(run, 150); return; }
      j.timer = 0;
      j.first = 0;
      if (!engine?.store.hasPending) return;
      const b = engine.store.peekPending();
      void journal.write(page.id, [...b.upserts.map((x) => strokeToElement(x, page.id)), ...b.objects.map((o) => objToElement(o, page.id))], b.deletes)
        .then((n) => { j.seq = n; })
        .catch(console.error);
    };
    j.timer = window.setTimeout(run, Math.max(0, Math.min(250, j.first + 2500 - now)));
  }, [page.id]);

  const scheduleSave = useCallback(() => {
    journalSoon();
    const s = saveRef.current;
    const now = Date.now();
    if (!s.first) s.first = now;
    setSave((v) => (v === "pending" ? v : "pending"));
    clearTimeout(s.timer);
    const wait = Math.max(0, Math.min(SAVE_DELAY, s.first + SAVE_MAX_WAIT - now));
    // Nie mitten im Strich speichern: solange Eingabe läuft, kurz zurückstellen (Stift bleibt flüssig)
    const tryFlush = () => {
      if (engineRef.current?.inputActive) s.timer = window.setTimeout(tryFlush, 200);
      else void flush();
    };
    s.timer = window.setTimeout(tryFlush, wait);
  }, [flush, journalSoon]);

  // ---- Engine-Lebenszyklus ----
  useEffect(() => {
    const engine = new CanvasEngine(hostRef.current!, baseRef.current!, activeRef.current!);
    engineRef.current = engine;
    if (import.meta.env.DEV) (window as unknown as { __nfEngine?: CanvasEngine }).__nfEngine = engine; // Profiling-Skripte
    engine.setObjectLayer(layerElRef.current);
    engine.events = {
      onHistory: (canUndo, canRedo) => setHistory((h) => (h.canUndo === canUndo && h.canRedo === canRedo ? h : { canUndo, canRedo })),
      onDirty: () => {
        scheduleSave();
        anchorsSoon.current();
      },
      onCamera: (s) => {
        if (zoomRef.current) zoomRef.current.textContent = `${Math.round(s * 100)} %`;
      },
      onSelection: setSel,
      onObjects: (o) => setObjects([...o]),
      onRadial: setRadial,
      onShape: (label) => flash(`Form erkannt: ${label}`),
      onToast: (msg) => flash(msg),
      onAngle: setAngle,
      onHoverObj: (id) => setHoverId(id),
      onObjTap: (id, x, y) => {
        setEditingId(id);
        // Nach dem Rendern (Feld jetzt bedienbar): Zelle/Text an der Tippstelle fokussieren
        window.setTimeout(() => {
          const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[contenteditable=true]")
            ?? document.querySelector<HTMLElement>(`[data-id="${id}"] [contenteditable=true]`);
          if (!hit) return;
          hit.focus({ preventScroll: true });
          const r = document.caretRangeFromPoint?.(x, y);
          if (r && hit.contains(r.startContainer)) {
            const s = window.getSelection();
            s?.removeAllRanges();
            s?.addRange(r);
          }
        }, 40);
      },
      onTextAt: (w, free) => {
        const pl = placeText(engine.pageSetup(), w, free, textMetrics());
        const o = makeObj<TextObj>({
          id: uid(), kind: "text", z: engine.nextZ(), x: pl.x, y: pl.y, w: 320, h: pl.lineHeight ?? 44, angle: 0,
          data: pl.lineHeight ? { html: "", size: pl.size, lh: pl.lineHeight, padX: pl.padX, auto: true } : { html: "", auto: true },
        });
        engine.addObject(o);
        setEditingId(o.id);
      },
    };
    const t = useTools.getState();
    engine.setTool(t);
    const applyInput = (x: ReturnType<typeof useSetup.getState>) => engine.setInput({ gamma: x.pressureGamma, pmax: x.pressureMax, barrel: x.barrel });
    applyInput(useSetup.getState());
    const unsubInput = useSetup.subscribe(applyInput);
    const unsub = useTools.subscribe((s) => engine.setTool(s));
    let alive = true;
    api.listElements(page.id).then(
      (els) => {
        if (!alive) return;
        engine.load(
          els.map(elementToStroke).filter((s): s is Stroke => !!s),
          els.map(elementToObj).filter((o): o is CanvasObj => !!o),
        );
        setLoaded(true);
        const box = focus ? engine.elementBBox(focus) : null;
        if (box) engine.focusOn(box);
        api.listPageTags(page.id).then((t) => alive && setPageTags(t), console.error);
      },
      (err) => {
        console.error(err);
        setLoaded(true);
      },
    );
    void api.autoVersion(page.id, VERSION_INTERVAL).catch(console.error);
    const onUnload = () => void flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      alive = false;
      window.removeEventListener("beforeunload", onUnload);
      unsub();
      unsubInput();
      engine.commitSelection();
      const id = page.id;
      void flush().then(() => api.autoVersion(id, VERSION_INTERVAL)).catch(console.error);
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  useEffect(() => {
    engineRef.current?.setPage({
      mode: page.mode, orientation: page.orientation, background: page.background,
      bgSpacingMm: page.bgSpacingMm, pageColor: page.pageColor,
    });
  }, [page.mode, page.orientation, page.background, page.bgSpacingMm, page.pageColor]);

  useEffect(() => engineRef.current?.setDark(resolved === "dark"), [resolved]);

  // ---- Tags ----
  useEffect(() => {
    if (!tagsLoaded) void loadTags();
  }, [tagsLoaded, loadTags]);
  const tagMap = useMemo(() => {
    const m = new Map<string, ElementTag[]>();
    for (const t of pageTags) m.set(t.elementId, [...(m.get(t.elementId) ?? []), t]);
    return m;
  }, [pageTags]);
  const tagMapRef = useRef(tagMap);
  tagMapRef.current = tagMap;
  const computeAnchors = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next: TagAnchor[] = [];
    for (const [id, tags] of tagMapRef.current) {
      const bbox = engine.elementBBox(id);
      if (bbox) next.push({ id, bbox, tags });
    }
    setAnchors(next);
  }, []);
  const anchorsSoon = useRef(() => {});
  anchorsSoon.current = () => requestAnimationFrame(computeAnchors);
  useEffect(computeAnchors, [tagMap, computeAnchors, objects]);

  const toggleTag = useCallback(async (elementId: string, tagId: string, on: boolean) => {
    try {
      await flush(); // Element muss gespeichert sein (Fremdschlüssel)
      await api.setElementTag(elementId, tagId, on);
      setPageTags((t) => on
        ? [...t.filter((x) => !(x.elementId === elementId && x.tagId === tagId)), { elementId, tagId, done: false }]
        : t.filter((x) => !(x.elementId === elementId && x.tagId === tagId)));
    } catch (err) {
      console.error(err);
      flash("Tag konnte nicht gesetzt werden");
    }
  }, [flush, flash]);
  const setTagDone = useCallback((elementId: string, tagId: string, done: boolean) => {
    setPageTags((t) => t.map((x) => (x.elementId === elementId && x.tagId === tagId ? { ...x, done } : x)));
    api.setTagDone(elementId, tagId, done).catch((err) => {
      console.error(err);
      setPageTags((t) => t.map((x) => (x.elementId === elementId && x.tagId === tagId ? { ...x, done: !done } : x)));
    });
  }, []);

  // ---- PDF ----
  const runBusy = async (f: () => Promise<void>, fail: string) => {
    try {
      await f();
    } catch (err) {
      console.error(err);
      flash(`${fail}: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(null);
    }
  };
  const insertPdf = (file: File, at?: Vec) => runBusy(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setBusy("PDF wird gelesen …");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await putAsset(page.id, bytes);
    const imgs = await pdfToImages(bytes.slice().buffer, (d, n) => setBusy(`PDF-Seite ${d} von ${n} …`));
    const b = engine.contentBounds();
    const bottom = b ? b.y + b.h : null;
    const objs = layoutPdfPages(imgs, page.mode === "a4"
      ? { mode: "a4", orientation: page.orientation, firstIndex: firstFreeA4(bottom, page.orientation), z: 0, asset }
      : at
        ? { mode: "infinite", orientation: page.orientation, top: at.y, left: at.x, z: 0, asset }
        : { mode: "infinite", orientation: page.orientation, top: bottom === null ? 0 : bottom + A4_GAP, z: 0, asset })
      .map((o) => ({ ...o, z: engine.nextZ() }));
    engine.addObjects(objs);
    if (objs[0]) engine.focusOn(objs[0].bbox);
    flash(imgs.length === 1 ? "1 PDF-Seite eingefügt" : `${imgs.length} PDF-Seiten eingefügt`);
  }, "PDF-Import fehlgeschlagen");

  // ---- Erkennung (Phase 7) ----
  const inkToText = () => runBusy(async () => {
    const engine = engineRef.current;
    const ink = engine?.selectionInk();
    if (!engine || !ink?.points.length) return;
    setBusy("Handschrift wird erkannt …");
    const r = await recognition.recognizeStrokes(ink.points);
    if (!r.text.trim()) { flash("Keine Schrift erkannt"); return; }
    const b = ink.bbox;
    const o = makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x: b.x, y: b.y, w: Math.max(160, b.w), h: Math.max(44, b.h), angle: 0, data: { html: textHtml(r.text) } });
    engine.replaceSelection([o]);
    flash("In Text umgewandelt");
  }, "Erkennung fehlgeschlagen");

  const inkToFormula = async () => {
    const ink = engineRef.current?.selectionInk();
    if (!ink?.points.length) return;
    setBusy("Formel wird erkannt …");
    try {
      const r = await recognition.recognizeStrokes(ink.points);
      setLatexReq({ latex: inkToLatex(r.words, ink.boxes) });
    } catch (err) {
      const msg = errText(err);
      setLatexReq({ latex: "", note: msg === UNAVAILABLE ? `${msg} – Formel hier von Hand eingeben.` : `Erkennung fehlgeschlagen (${msg}) – Formel von Hand eingeben.` });
    } finally {
      setBusy(null);
    }
  };

  const insertFormula = (latex: string, keep: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    const target = latexReq?.target;
    if (target) {
      const cur = engine.store.getObj(target.id);
      if (cur?.kind !== "text") return;
      const next = { ...cur, data: { ...cur.data, latex } };
      engine.updateObjectLive(next);
      engine.recordObjectEdit(cur, next);
      return;
    }
    const ink = engine.selectionInk();
    if (!ink) return;
    const b = ink.bbox;
    // Beim Behalten der Handschrift die Formel rechts daneben setzen
    const x = keep ? b.x + b.w + 16 : b.x;
    const o = makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x, y: b.y, w: Math.max(120, b.w), h: Math.max(44, b.h), angle: 0, data: { html: "", latex } });
    engine.replaceSelection([o], keep);
  };

  const ocrSelection = () => runBusy(async () => {
    const img = engineRef.current?.selectionInk()?.images[0];
    const bytes = img && dataUrlBytes(img.data.src);
    if (!img || !bytes) return;
    setBusy("Text im Bild wird gelesen …");
    try {
      const r = await recognition.ocrImage(bytes);
      setOcrView({ text: r.text });
    } catch (err) {
      setOcrView({ text: "", error: errText(err) });
    }
  }, "OCR fehlgeschlagen");

  const insertOcrText = (text: string) => {
    const engine = engineRef.current;
    const img = engine?.selectionInk()?.images[0];
    if (!engine || !img) return;
    engine.commitSelection();
    engine.addObject(makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x: img.bbox.x + img.bbox.w + 16, y: img.bbox.y, w: 320, h: 44, angle: 0, data: { html: textHtml(text) } }));
  };

  const doExport = (scope: ExportScope) => runBusy(async () => {
    setBusy("PDF wird erstellt …");
    engineRef.current?.commitSelection();
    await flush();
    const list = pagesInScope(scope, page, sections, pages).map((p) => (p.id === page.id ? page : p));
    const name = scope === "page" ? page.title || "Blatt"
      : scope === "section" ? sections.find((x) => x.id === page.sectionId)?.name ?? "Thema" : subjectName || "Fach";
    const bytes = await exportPdf(list, name, setBusy);
    setBusy(null);
    if (await saveExport(bytes, pdfFileName(name))) flash("PDF exportiert");
  }, "Export fehlgeschlagen");

  // ---- Tastatur ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const engine = engineRef.current;
      if (!engine) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) engine.undo();
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) engine.redo();
      else if (mod && (k === "+" || k === "=")) engine.zoomBy(1.25);
      else if (mod && k === "-") engine.zoomBy(1 / 1.25);
      else if (mod && k === "0") engine.resetView();
      else if (mod && k === "1") { e.preventDefault(); engine.fitContent(); }
      else if (mod && k === "s") void flush();
      else if ((k === "delete" || k === "backspace") && engine.hasSelection) engine.deleteSelection();
      else if (k === "delete" && editingRef.current) {
        // Textfeld aktiv, aber nicht im Schreibmodus → ganzes Textfeld löschen
        engine.removeObject(editingRef.current);
        setEditingId(null);
      }
      else if (mod && k === "t" && e.shiftKey) useTools.getState().setTool("text");
      else if (k === "escape") engine.commitSelection();
      else if (k.startsWith("arrow") && engine.hasSelection) {
        // Pfeiltasten: 1 px fein, mit Umschalt ein Rasterschritt
        const d = e.shiftKey ? engine.gridStep() : 1 / engine.zoom;
        const dx = k === "arrowleft" ? -d : k === "arrowright" ? d : 0;
        const dy = k === "arrowup" ? -d : k === "arrowdown" ? d : 0;
        if (!engine.nudgeSelection(dx, dy)) return;
      }
      else if (!mod && !e.altKey && toolKey(k, e.shiftKey)) { /* Werkzeug gewechselt */ }
      else return;
      e.preventDefault();
    };
    const alt = (e: KeyboardEvent) => { if (engineRef.current) engineRef.current.snapOff = e.altKey; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", alt);
    window.addEventListener("keyup", alt);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", alt);
      window.removeEventListener("keyup", alt);
    };
  }, [flush]);


  const e = () => engineRef.current;

  // ---- Einfügen: Bilder, Screenshot, Tabelle, Text ----
  const insertImage = useCallback((img: LoadedImage, at?: Vec) => {
    const engine = engineRef.current;
    if (!engine) return;
    const maxW = engine.viewWidth * 0.6;
    const k = Math.min(1, maxW / img.w);
    const w = img.w * k, h = img.h * k;
    const c = at ?? engine.viewCenter();
    engine.addObject(makeObj<ImageObj>({ id: uid(), kind: "image", z: engine.nextZ(), x: c.x - w / 2, y: c.y - h / 2, w, h, angle: 0, data: { src: img.src } }));
    useTools.getState().setTool("lasso"); // Bild ist ausgewählt → direkt verschieben/skalieren
  }, []);

  const insertFiles = useCallback(async (files: Iterable<File>, at?: Vec) => {
    for (const f of files) {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        await insertPdf(f, at);
        continue;
      }
      if (!f.type.startsWith("image/")) continue;
      try {
        insertImage(await fileToImage(f), at);
      } catch (err) {
        console.error(err);
        flash("Bild konnte nicht eingefügt werden");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertImage, flash, page.id, page.mode]);

  // ---- Rechner/Plotter (Phase 11): Graph als Bild mit Spezifikation, Rechnung als Textfeld ----
  useEffect(() => {
    const host = {
      insertPlot(spec: PlotSpec, svg: string, replace: boolean) {
        const engine = engineRef.current;
        if (!engine) return;
        const src = svgDataUrl(svg);
        const old = replace ? engine.selectionInk()?.images.find((i) => i.data.plot) : undefined;
        if (old) {
          engine.replaceSelectedImage(makeObj<ImageObj>({ ...old, h: old.w * 0.75, data: { src, plot: spec } }));
          flash("Graph aktualisiert");
          return;
        }
        const c = engine.viewCenter();
        engine.addObject(makeObj<ImageObj>({ id: uid(), kind: "image", z: engine.nextZ(), x: c.x - 240, y: c.y - 180, w: 480, h: 360, angle: 0, data: { src, plot: spec } }));
        useCalc.setState({ editing: true }); // weitere Änderungen ersetzen diesen Graphen (er ist ausgewählt)
        useTools.getState().setTool("lasso");
      },
      insertText(text: string) {
        const engine = engineRef.current;
        if (!engine) return;
        const c = engine.viewCenter();
        engine.addObject(makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x: c.x - 160, y: c.y - 22, w: 320, h: 44, angle: 0, data: { html: textHtml(text) } }));
        flash("Rechnung eingefügt");
      },
    };
    useCalc.getState().setHost(host);
    return () => {
      // Blatt geschlossen → Rechner/Grapheditor mit schließen
      if (useCalc.getState().host === host) { useCalc.getState().setHost(null); useCalc.getState().toggle(false); }
    };
  }, [flash]);

  const gridStep = () => (page.background === "blank" ? 5 : page.bgSpacingMm) * MM;

  /** Vorlage aus der Formen-Bibliothek einfügen: oben links am Karo der Ansichtsmitte eingerastet. */
  const insertVec = (spec: VecSpec) => {
    const engine = engineRef.current;
    if (!engine) return;
    const c = engine.viewCenter(), g = gridStep();
    const probe = vecObj(spec, { x: 0, y: 0 }, 0);
    const at = { x: Math.round((c.x - probe.w / 2) / g) * g, y: Math.round((c.y - probe.h / 2) / g) * g };
    if (spec.t === "coord") {
      // Achsenursprung auf eine Karolinie legen (Rand 28 px im Element)
      at.x = Math.round((at.x + 28) / g) * g - 28;
      at.y = Math.round((at.y + 28) / g) * g - 28;
    }
    engine.addObject(vecObj(spec, at, engine.nextZ()));
    useTools.getState().setTool("lasso");
  };

  /** Strukturformel einfügen bzw. ersetzen (Lage, Drehung und Skalierung bleiben erhalten). */
  const placeMol = (d: MolData, r: MolSvg, edit: ImageObj | null) => {
    const engine = engineRef.current;
    if (!engine) return;
    const src = molSvgUrl(r.svg);
    if (edit?.data.mol) {
      const old = renderMol(fromMolfile(edit.data.mol.molfile), edit.data.mol.view);
      const k = edit.w / old.w;
      engine.replaceImage(edit, makeObj<ImageObj>({ ...edit, w: r.w * k, h: r.h * k, data: { src, mol: d } }));
    } else {
      const c = engine.viewCenter(), g = gridStep();
      const x = Math.round((c.x - r.w / 2) / g) * g, y = Math.round((c.y - r.h / 2) / g) * g;
      engine.addObject(makeObj<ImageObj>({ id: uid(), kind: "image", z: engine.nextZ(), x, y, w: r.w, h: r.h, angle: 0, data: { src, mol: d } }));
      useTools.getState().setTool("lasso");
    }
  };
  const selectedMol = () => engineRef.current?.selectionInk()?.images.find((i) => i.data.mol) ?? null;
  const setMolView = (v: MolView) => {
    const o = selectedMol();
    if (o?.data.mol) placeMol({ ...o.data.mol, view: v }, renderMol(fromMolfile(o.data.mol.molfile), v), o);
  };

  useEffect(() => {
    const open = () => setChem({ edit: null });
    window.addEventListener("nf-molecule", open);
    return () => window.removeEventListener("nf-molecule", open);
  }, []);

  useEffect(() => {
    const open = () => setShapes({ edit: null });
    window.addEventListener("nf-shapes", open);
    return () => window.removeEventListener("nf-shapes", open);
  }, []);

  const onInsert = async (kind: InsertKind, size?: { rows: number; cols: number }) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (kind === "shapes") return setShapes({ edit: null });
    if (kind === "molecule") return setChem({ edit: null });
    if (kind === "plot") {
      engine.commitSelection();
      useCalc.getState().openPlot(null, false);
    } else if (kind === "calc") useCalc.getState().toggle(true);
    else if (kind === "image") fileRef.current?.click();
    else if (kind === "pdf") pdfRef.current?.click();
    else if (kind === "screenshot") {
      try {
        setShot(await captureScreen());
      } catch (err) {
        console.warn(err);
        flash("Bildschirmaufnahme abgebrochen oder nicht verfügbar");
      }
    } else if (kind === "table") {
      const c = engine.viewCenter();
      const data = newTable(size?.rows ?? 3, size?.cols ?? 3);
      const n = data.cells[0].length, w = Math.min(960, Math.max(240, n * 120)), h = 44 * data.cells.length;
      const t = makeObj<TableObj>({ id: uid(), kind: "table", z: engine.nextZ(), x: c.x - w / 2, y: c.y - Math.min(h, 300) / 2, w, h, angle: 0, data });
      engine.addObject(t);
      useTools.getState().setTool("text");
      setEditingId(t.id);
      focusCell(t.id, 0, 0);
    } else {
      const c = engine.viewCenter();
      const o = makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x: c.x - 160, y: c.y - 22, w: 320, h: 44, angle: 0, data: { html: "", auto: true } });
      engine.addObject(o);
      useTools.getState().setTool("text");
      setEditingId(o.id);
    }
  };

  // Strg+V mit Bild
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      ev.preventDefault();
      void insertFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [insertFiles]);

  // Textwerkzeug verlassen → Bearbeitung beenden
  useEffect(() => {
    if (tool !== "text" && editingId) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const focusMode = usePrefs((s) => s.focus);
  const inkDebug = usePrefs((s) => s.inkDebug);
  const perfOn = usePrefs((s) => s.perfOverlay) || inkDebug;
  useEffect(() => { engineRef.current?.setInkDebug(inkDebug); }, [inkDebug, loaded]);

  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setActionsSlot(document.getElementById(PAGE_ACTIONS_SLOT)), []);
  const editingText = editingId && objects.find((o) => o.id === editingId)?.kind === "text";
  const saveLabel: Record<SaveState, string> = {
    saved: "Gespeichert", pending: "Ungespeicherte Änderungen", saving: "Speichert …", error: "Speichern fehlgeschlagen",
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={hostRef} data-testid="canvas-host" data-loaded={loaded} data-tool={tool}
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
        onPointerDownCapture={(ev) => {
          // Doppeltipp auf eine Strukturformel öffnet den Editor wieder
          const r = hostRef.current!.getBoundingClientRect(), p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
          const l = lastDown.current, now = performance.now();
          lastDown.current = { t: now, ...p };
          if (!l || now - l.t > 400 || Math.hypot(p.x - l.x, p.y - l.y) > 24) return;
          const o = engineRef.current?.molAt(p);
          if (!o) return;
          ev.stopPropagation();
          lastDown.current = null;
          setChem({ edit: o });
        }}
        onDragOver={(ev) => {
          if ([...ev.dataTransfer.items].some((i) => i.type.startsWith("image/") || i.type === "application/pdf")) ev.preventDefault();
        }}
        onDrop={(ev) => {
          const files = [...ev.dataTransfer.files];
          if (!files.length) return;
          ev.preventDefault();
          const r = hostRef.current!.getBoundingClientRect();
          void insertFiles(files, engineRef.current?.screenToWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top }));
        }}>
        <canvas ref={baseRef} className="absolute inset-0" />
        {perfOn && loaded && <PerfOverlay engine={engineRef.current} />}
        {/* Blatt-Aktionen: rechts in der farbigen Kopfzeile; ohne Kopfzeile (Fokusmodus) entfallen sie */}
        {actionsSlot && !focusMode && createPortal(
          <div data-page-actions className="flex items-center gap-0.5">
            <span role="status" data-testid="save-status" data-state={save} title={saveLabel[save]}
            className={cn("px-2 text-xs", save === "error" ? "font-semibold" : "opacity-80")}>
            {save === "saved" ? "✓" : saveLabel[save]}
          </span>
          <Button variant="ghost" size="icon" aria-label="Seitenversionen" title="Seitenversionen" onClick={() => setVersions(true)}><History /></Button>
          <Button variant="ghost" size="icon" aria-label="Ink-Wiedergabe" title="Ink-Wiedergabe" aria-pressed={replay}
            onClick={() => { engineRef.current?.commitSelection(); setReplay((r) => !r); }}>
            <PlayCircle />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Blatt-Aktionen" title="Blatt-Aktionen"><MoreVertical /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="truncate">{page.title}</DropdownMenuLabel>
              <DropdownMenuLabel className="pt-0 text-xs font-normal text-muted-foreground">
                Erstellt {new Date(page.createdAt).toLocaleString("de-DE")} · Geändert {new Date(page.updatedAt).toLocaleString("de-DE")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Als PDF exportieren</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void doExport("page")}><Download /> Dieses Blatt</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport("section")}><Download /> Ganzes Thema</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport("subject")}><Download /> Ganzes Fach</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pdfRef.current?.click()}><FileUp /> PDF-Seiten einfügen …</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTplDialog(true)}><LayoutTemplate /> Als Vorlage speichern …</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>, actionsSlot)}
        {loaded && <SpitzHint />}
        <canvas ref={activeRef} data-testid="canvas-input" className="absolute inset-0" style={{ touchAction: "none" }} />
        <ObjectLayer
          objects={objects}
          engine={engineRef.current}
          interactive={tool === "text"}
          editingId={editingId}
          hoverId={hoverId}
          onEditing={setEditingId}
          layerRef={(el) => {
            layerElRef.current = el;
            engineRef.current?.setObjectLayer(el);
          }}
          dark={resolved === "dark"}
          tags={tagMap}
          anchors={anchors}
          onTag={(id, tagId, on) => void toggleTag(id, tagId, on)}
          onTagDone={setTagDone}
          onLink={(t) => onOpenLink?.(t)}
          onEditLatex={(o) => setLatexReq({ latex: o.data.latex ?? "", edit: true, target: o })}
        />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-hidden
          onChange={(ev) => { void insertFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden aria-hidden data-testid="pdf-input"
          onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void insertPdf(f); }} />
        <Toolbar
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={() => e()?.undo()}
          onRedo={() => e()?.redo()}
          zoomLabelRef={zoomRef}
          onZoom={(f) => (f === "reset" ? e()?.resetView() : f === "fit" ? e()?.fitContent() : e()?.zoomBy(f))}
          page={page}
          onPageChange={onPageChange}
          onInsert={(k, sz) => void onInsert(k, sz)}
        />
        {editingText && <FormatBar onDone={() => { (document.activeElement as HTMLElement | null)?.blur?.(); setEditingId(null); }} />}
        {radial && (
          <RadialMenu at={radial} hostW={hostRef.current?.clientWidth ?? 800} hostH={hostRef.current?.clientHeight ?? 600}
            onClose={() => setRadial(null)} onUndo={() => e()?.undo()} onRedo={() => e()?.redo()} />
        )}
        {toast && (
          <div role="status" data-testid="canvas-toast"
            className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            {toast}
          </div>
        )}
        {shot && (
          <ScreenshotCrop shot={shot} onCancel={() => setShot(null)}
            onDone={async (c) => { setShot(null); insertImage(await encodeImage(c, false)); }} />
        )}
        {sel && (
          <SelectionMenu
            sel={sel}
            hostHeight={hostRef.current?.clientHeight ?? 600}
            onColor={(c) => e()?.recolorSelection(c)}
            onCopy={() => e()?.duplicateSelection()}
            onDelete={() => e()?.deleteSelection()}
            onLock={() => e()?.lockSelection()}
            onDone={() => e()?.commitSelection()}
            onInkToText={() => void inkToText()}
            onInkToLatex={() => void inkToFormula()}
            onOcr={() => void ocrSelection()}
            onEditPlot={plotSel ? () => useCalc.getState().openPlot(plotSel, true) : undefined}
            onHeads={(h) => e()?.setSelectionHeads(h)}
            onEditVec={() => setShapes({ edit: sel.vec })}
            onSaveTemplate={() => setShapeTplName(true)}
            onEditMol={() => { const o = selectedMol(); if (o) setChem({ edit: o }); }}
            onMolView={setMolView}
            activeTags={new Set((tagMap.get(sel.ids[0]) ?? []).map((t) => t.tagId))}
            onTag={(tagId, on) => void toggleTag(sel.ids[0], tagId, on)}
          />
        )}
        {zoomWrite && loaded && engineRef.current && <ZoomWriter engine={engineRef.current} dark={resolved === "dark"} hostRef={hostRef} />}
        {angle && tool === "angle" && (
          <div role="dialog" aria-label="Winkel" data-testid="angle-result"
            className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card p-1 pl-3 shadow-lg"
            style={{ left: angle.at.x, top: Math.max(8, angle.at.y + 28) }}>
            <span className="mr-1 text-lg font-semibold tabular-nums">{fmtDeg(angle.deg)}</span>
            <Button variant="secondary" className="h-11" onClick={() => e()?.insertAngleLabel()}>Als Beschriftung einfügen</Button>
            <Button variant="ghost" className="h-11" onClick={() => e()?.resetAngle()}>Neu messen</Button>
          </div>
        )}
        {replay && engineRef.current && <InkReplay engine={engineRef.current} onClose={() => setReplay(false)} />}
        {busy && (
          <div role="status" data-testid="canvas-busy"
            className="pointer-events-none absolute top-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            {busy}
          </div>
        )}
      </div>
      <LatexDialog req={latexReq} onOpenChange={(o) => !o && setLatexReq(null)} onInsert={insertFormula} />
      <OcrDialog view={ocrView} onOpenChange={(o) => !o && setOcrView(null)} onInsert={insertOcrText} />
      <VersionsDialog open={versions} onOpenChange={setVersions} pageId={page.id}
        beforeAction={async () => { engineRef.current?.commitSelection(); await flush(); }}
        onRestored={() => onPageReplaced?.()} />
      <MoleculeEditor open={!!chem} initial={chem?.edit?.data.mol ?? null} onOpenChange={(o) => !o && setChem(null)}
        onInsert={(d, r) => { placeMol(d, r, chem?.edit ?? null); setChem(null); }} />
      <ShapeLibrary open={!!shapes} onOpenChange={(o) => !o && setShapes(null)} grid={gridStep()} color={useTools.getState().color}
        edit={shapes?.edit ?? null} onInsert={insertVec} onUpdate={(spec) => e()?.updateSelectedVec(spec)}
        onInsertTemplate={(t) => {
          const engine = engineRef.current;
          if (!engine) return;
          try {
            const d = decodeTemplate(t.data), c = engine.viewCenter();
            engine.insertElements(d.strokes, d.objs, { x: c.x - d.w / 2, y: c.y - d.h / 2 });
            useTools.getState().setTool("lasso");
          } catch (err) {
            console.error(err);
            flash("Vorlage konnte nicht eingefügt werden");
          }
        }} />
      <NameDialog open={shapeTplName} onOpenChange={setShapeTplName} title="Als Vorlage speichern" label="Name der Form"
        initial="" submitLabel="Speichern"
        onSubmit={(name) => void runBusy(async () => {
          const el = engineRef.current?.selectionElements();
          if (!el) return;
          await shapesApi.save(name, encodeTemplate(el.strokes, el.objs, el.bbox));
          flash(`Form „${name}“ gespeichert – Formen-Bibliothek → Eigene`);
        }, "Form konnte nicht gespeichert werden")} />
      <NameDialog open={tplDialog} onOpenChange={setTplDialog} title="Als Vorlage speichern" label="Name der Vorlage"
        initial={page.title} submitLabel="Speichern"
        onSubmit={(name) => void runBusy(async () => {
          await flush();
          await api.saveTemplate(page.id, name);
          flash(`Vorlage „${name}“ gespeichert`);
        }, "Vorlage konnte nicht gespeichert werden")} />
    </div>
  );
}

/** Einzeltasten für Werkzeuge (ohne Strg). Liefert true, wenn die Taste belegt ist. */
function toolKey(k: string, shift: boolean): boolean {
  const t = useTools.getState();
  if (shift) return false;
  switch (k) {
    case "b": t.setPen(t.pen === "highlighter" ? "fountain" : t.pen); return true;
    case "m": t.setPen("highlighter"); return true;
    case "e": t.setTool("eraser"); return true;
    case "l": t.setTool("lasso"); return true;
    case "t": t.setTool("text"); return true;
    case "h": t.setTool("pan"); return true;
    case "r": t.setShapeMode(!t.shapeMode); return true;
    case "f": t.setTool("fill"); return true;
    case "w": t.setTool("angle"); return true;
    case "p": t.setTool("laser"); return true;
    case "v": t.setTool("vanish"); return true;
    case "z": t.setZoom({ zoomWrite: !t.zoomWrite }); return true;
    case "s": window.dispatchEvent(new CustomEvent("nf-shapes")); return true;
  }
  const n = Number(k);
  if (Number.isInteger(n) && n >= 1 && n <= 9 && t.presets[n - 1]) {
    t.applyPreset(t.presets[n - 1]);
    return true;
  }
  return false;
}
