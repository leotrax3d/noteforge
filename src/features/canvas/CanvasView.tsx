import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme/theme-provider";
import { CanvasEngine, type SelectionInfo } from "@/canvas/core/engine";
import { elementToStroke, strokeToElement } from "@/canvas/core/codec";
import type { Stroke } from "@/canvas/core/model";
import { api } from "@/lib/api";
import type { Page, PagePatch } from "@/lib/types";
import { Toolbar } from "./Toolbar";
import { SelectionMenu } from "./SelectionMenu";
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
  const { resolved } = useTheme();

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
      .then(() => api.saveElements(page.id, batch.upserts.map((x) => strokeToElement(x, page.id)), batch.deletes))
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
    engine.events = {
      onHistory: (canUndo, canRedo) => setHistory((h) => (h.canUndo === canUndo && h.canRedo === canRedo ? h : { canUndo, canRedo })),
      onDirty: scheduleSave,
      onCamera: (s) => {
        if (zoomRef.current) zoomRef.current.textContent = `${Math.round(s * 100)} %`;
      },
      onSelection: setSel,
    };
    const t = useTools.getState();
    engine.setTool(t);
    const unsub = useTools.subscribe((s) => engine.setTool(s));
    let alive = true;
    api.listElements(page.id).then(
      (els) => {
        if (!alive) return;
        engine.load(els.map(elementToStroke).filter((s): s is Stroke => !!s));
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
      <div ref={hostRef} data-testid="canvas-host" data-loaded={loaded} className="relative min-h-0 flex-1 touch-none overflow-hidden select-none">
        <canvas ref={baseRef} className="absolute inset-0" />
        <canvas ref={activeRef} data-testid="canvas-input" className="absolute inset-0" style={{ touchAction: "none" }} />
        <Toolbar
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={() => e()?.undo()}
          onRedo={() => e()?.redo()}
          zoomLabelRef={zoomRef}
          onZoom={(f) => (f === "reset" ? e()?.resetView() : e()?.zoomBy(f))}
          page={page}
          onPageChange={onPageChange}
        />
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
