import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, History, LayoutTemplate, MoreVertical, PlayCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { ObjectLayer } from "./objects/ObjectLayer";
import { FormatBar } from "./objects/FormatBar";
import { captureScreen, encodeImage, fileToImage, type LoadedImage } from "./objects/images";
import { useTools } from "./tool-store";
import { usePrefs } from "@/store/prefs";
import { PerfOverlay } from "./PerfOverlay";
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

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textHtml = (t: string) => t.split("\n").map((l) => `<div>${escapeHtml(l) || "<br>"}</div>`).join("");

/** Zeichenfläche eines Blatts: Engine + Werkzeugleiste + Autospeichern. */
export function CanvasView({ page, onRename, onPageChange, focus, onOpenLink, onPageReplaced, sections = [], pages = [], subjectName = "" }: {
  page: Page;
  onRename: (title: string) => void;
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
    setSave("saving");
    s.chain = s.chain
      .then(() => api.saveElements(
        page.id,
        [...batch.upserts.map((x) => strokeToElement(x, page.id)), ...batch.objects.map((o) => objToElement(o, page.id))],
        batch.deletes,
      ))
      .then(() => {
        setSave(engine.store.hasPending ? "pending" : "saved");
        // Erkennung für die Suche (Handschrift + OCR) im Hintergrund, erst nach einer Ruhepause
        clearTimeout(recTimer.current);
        const pid = page.id;
        recTimer.current = window.setTimeout(() => void recognition.recognizePage(pid).catch(console.error), RECOGNIZE_DELAY);
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

  const scheduleSave = useCallback(() => {
    const s = saveRef.current;
    const now = Date.now();
    if (!s.first) s.first = now;
    setSave((v) => (v === "pending" ? v : "pending"));
    clearTimeout(s.timer);
    const wait = Math.max(0, Math.min(SAVE_DELAY, s.first + SAVE_MAX_WAIT - now));
    s.timer = window.setTimeout(() => void flush(), wait);
  }, [flush]);

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
      onTextAt: (w) => {
        const o = makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x: w.x, y: w.y - 16, w: 320, h: 44, angle: 0, data: { html: "" } });
        engine.addObject(o);
        setEditingId(o.id);
      },
    };
    const t = useTools.getState();
    engine.setTool(t);
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
      : scope === "section" ? sections.find((x) => x.id === page.sectionId)?.name ?? "Themengruppe" : subjectName || "Fach";
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
      else if (mod && k === "s") void flush();
      else if ((k === "delete" || k === "backspace") && engine.hasSelection) engine.deleteSelection();
      else if (mod && k === "t" && e.shiftKey) useTools.getState().setTool("text");
      else if (k === "escape") engine.commitSelection();
      else if (!mod && !e.altKey && toolKey(k, e.shiftKey)) { /* Werkzeug gewechselt */ }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  const [title, setTitle] = useState(page.title);
  useEffect(() => setTitle(page.title), [page.id, page.title]);
  const commitTitle = () => title.trim() !== page.title && onRename(title);

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
    return () => { if (useCalc.getState().host === host) useCalc.getState().setHost(null); };
  }, [flash]);

  const onInsert = async (kind: InsertKind) => {
    const engine = engineRef.current;
    if (!engine) return;
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
      const cells = Array.from({ length: 3 }, () => Array<string>(3).fill(""));
      engine.addObject(makeObj<TableObj>({ id: uid(), kind: "table", z: engine.nextZ(), x: c.x - 180, y: c.y - 66, w: 360, h: 132, angle: 0, data: { cells } }));
      useTools.getState().setTool("text");
    } else {
      const c = engine.viewCenter();
      const o = makeObj<TextObj>({ id: uid(), kind: "text", z: engine.nextZ(), x: c.x - 160, y: c.y - 22, w: 320, h: 44, angle: 0, data: { html: "" } });
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

  const editingText = editingId && objects.find((o) => o.id === editingId)?.kind === "text";
  const saveLabel: Record<SaveState, string> = {
    saved: "Gespeichert", pending: "Ungespeicherte Änderungen", saving: "Speichert …", error: "Speichern fehlgeschlagen",
  };

  return (
    <div className="flex h-full flex-col">
      <div className={focusMode ? "hidden" : "flex items-end gap-4 border-b px-6 py-2"}>
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Blatttitel"
            placeholder="Unbenanntes Blatt"
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            onBlur={commitTitle}
            onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLInputElement).blur()}
            className="h-11 border-transparent bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:border-input md:text-2xl dark:bg-transparent"
          />
          <p className="text-xs text-muted-foreground">
            Erstellt {new Date(page.createdAt).toLocaleString("de-DE")} · Geändert {new Date(page.updatedAt).toLocaleString("de-DE")}
          </p>
        </div>
        <p role="status" data-testid="save-status" data-state={save}
          className={save === "error" ? "pb-1 text-xs text-destructive" : "pb-1 text-xs text-muted-foreground"}>
          {saveLabel[save]}
        </p>
        <div className="flex items-center">
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
              <DropdownMenuLabel>Als PDF exportieren</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void doExport("page")}><Download /> Dieses Blatt</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport("section")}><Download /> Ganze Themengruppe</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void doExport("subject")}><Download /> Ganzes Fach</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pdfRef.current?.click()}><FileUp /> PDF-Seiten einfügen …</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTplDialog(true)}><LayoutTemplate /> Als Vorlage speichern …</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div ref={hostRef} data-testid="canvas-host" data-loaded={loaded} data-tool={tool}
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
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
        <canvas ref={activeRef} data-testid="canvas-input" className="absolute inset-0" style={{ touchAction: "none" }} />
        <ObjectLayer
          objects={objects}
          engine={engineRef.current}
          interactive={tool === "text"}
          editingId={editingId}
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
          onZoom={(f) => (f === "reset" ? e()?.resetView() : e()?.zoomBy(f))}
          page={page}
          onPageChange={onPageChange}
          onInsert={(k) => void onInsert(k)}
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
            onDone={() => e()?.commitSelection()}
            onInkToText={() => void inkToText()}
            onInkToLatex={() => void inkToFormula()}
            onOcr={() => void ocrSelection()}
            onEditPlot={plotSel ? () => useCalc.getState().openPlot(plotSel, true) : undefined}
            activeTags={new Set((tagMap.get(sel.ids[0]) ?? []).map((t) => t.tagId))}
            onTag={(tagId, on) => void toggleTag(sel.ids[0], tagId, on)}
          />
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
  }
  const n = Number(k);
  if (Number.isInteger(n) && n >= 1 && n <= 9 && t.presets[n - 1]) {
    t.applyPreset(t.presets[n - 1]);
    return true;
  }
  return false;
}
