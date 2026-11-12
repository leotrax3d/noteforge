import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme/theme-provider";
import { CanvasEngine, type SelectionInfo } from "@/canvas/core/engine";
import { elementToStroke, strokeToElement } from "@/canvas/core/codec";
import { uid, type Stroke } from "@/canvas/core/model";
import { elementToObj, makeObj, objToElement, type CanvasObj, type ImageObj, type TableObj, type TextObj } from "@/canvas/core/objects";
import type { Vec } from "@/canvas/core/geometry";
import { api } from "@/lib/api";
import type { Page, PagePatch } from "@/lib/types";
import { Toolbar, type InsertKind } from "./Toolbar";
import { SelectionMenu } from "./SelectionMenu";
import { RadialMenu } from "./RadialMenu";
import { ScreenshotCrop } from "./ScreenshotCrop";
import { ObjectLayer } from "./objects/ObjectLayer";
import { FormatBar } from "./objects/FormatBar";
import { captureScreen, encodeImage, fileToImage, type LoadedImage } from "./objects/images";
import { useTools } from "./tool-store";

type SaveState = "saved" | "pending" | "saving" | "error";
const SAVE_DELAY = 800;
const SAVE_MAX_WAIT = 5000;

/** Zeichenfläche eines Blatts: Engine + Werkzeugleiste + Autospeichern. */
export function CanvasView({ page, onRename, onPageChange }: {
  page: Page;
  onRename: (title: string) => void;
  onPageChange: (patch: PagePatch) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [loaded, setLoaded] = useState(false);
  const [objects, setObjects] = useState<CanvasObj[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [radial, setRadial] = useState<Vec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
      .then(() => setSave(engine.store.hasPending ? "pending" : "saved"))
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
    engine.setObjectLayer(layerElRef.current);
    engine.events = {
      onHistory: (canUndo, canRedo) => setHistory((h) => (h.canUndo === canUndo && h.canRedo === canRedo ? h : { canUndo, canRedo })),
      onDirty: scheduleSave,
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
      },
      (err) => {
        console.error(err);
        setLoaded(true);
      },
    );
    const onUnload = () => void flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      alive = false;
      window.removeEventListener("beforeunload", onUnload);
      unsub();
      engine.commitSelection();
      void flush();
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
      if (!f.type.startsWith("image/")) continue;
      try {
        insertImage(await fileToImage(f), at);
      } catch (err) {
        console.error(err);
        flash("Bild konnte nicht eingefügt werden");
      }
    }
  }, [insertImage, flash]);

  const onInsert = async (kind: InsertKind) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (kind === "image") fileRef.current?.click();
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

  const editingText = editingId && objects.find((o) => o.id === editingId)?.kind === "text";
  const saveLabel: Record<SaveState, string> = {
    saved: "Gespeichert", pending: "Ungespeicherte Änderungen", saving: "Speichert …", error: "Speichern fehlgeschlagen",
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-4 border-b px-6 py-2">
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
      </div>
      <div ref={hostRef} data-testid="canvas-host" data-loaded={loaded} data-tool={tool}
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
        onDragOver={(ev) => {
          if ([...ev.dataTransfer.items].some((i) => i.type.startsWith("image/"))) ev.preventDefault();
        }}
        onDrop={(ev) => {
          const files = [...ev.dataTransfer.files];
          if (!files.length) return;
          ev.preventDefault();
          const r = hostRef.current!.getBoundingClientRect();
          void insertFiles(files, engineRef.current?.screenToWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top }));
        }}>
        <canvas ref={baseRef} className="absolute inset-0" />
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
        />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-hidden
          onChange={(ev) => { void insertFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
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
          />
        )}
      </div>
    </div>
  );
}
