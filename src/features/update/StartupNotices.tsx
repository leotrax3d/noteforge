// Start-Hinweise: wiederhergestellte Änderungen (Absturzschutz) und Auto-Update (SPEC §10.2/§10.3).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { inTauri } from "@/lib/api";
import { journal } from "@/lib/journal";
import { powerSaving } from "@/lib/power";

type Upd = import("@tauri-apps/plugin-updater").Update;

export function StartupNotices() {
  const [recovered, setRecovered] = useState(0);
  const [upd, setUpd] = useState<Upd | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void journal.recovered().then((n) => {
      if (!n) return;
      setRecovered(n);
      window.setTimeout(() => setRecovered(0), 8000);
    }).catch(() => {});
    if (!inTauri) return;
    // Im Hintergrund prüfen (im Akkubetrieb später)
    const t = window.setTimeout(async () => {
      try {
        if (!(await invoke<boolean>("updater_enabled"))) return;
        const { check } = await import("@tauri-apps/plugin-updater");
        const u = await check();
        if (u) setUpd(u);
      } catch (e) {
        console.warn("Update-Prüfung", e);
      }
    }, powerSaving() ? 60_000 : 10_000);
    return () => window.clearTimeout(t);
  }, []);

  const download = async () => {
    if (!upd) return false;
    setState("loading");
    let total = 0, got = 0;
    try {
      await upd.download((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") { got += ev.data.chunkLength; if (total) setPct(Math.round((got / total) * 100)); }
      });
      setState("ready");
      return true;
    } catch (e) {
      setErr(String(e));
      setState("error");
      return false;
    }
  };

  const installNow = async () => {
    if (state !== "ready" && !(await download())) return;
    await upd!.install();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  };

  const installOnExit = async () => {
    setOpen(false);
    if (state !== "ready" && !(await download())) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.onCloseRequested(async (ev) => {
      ev.preventDefault();
      try { await upd!.install(); } finally { await w.destroy(); }
    });
  };

  return (
    <>
      {recovered > 0 && (
        <div role="status" data-testid="recovered-notice" data-glass="" className="[html.glass_&]:text-foreground fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground py-1 pr-1 pl-4 text-sm text-background shadow-lg">
          <RotateCcw className="size-4" /> {recovered} {recovered === 1 ? "Änderung" : "Änderungen"} wiederhergestellt
          <Button variant="ghost" size="icon" aria-label="Hinweis schließen" className="text-background hover:bg-background/20" onClick={() => setRecovered(0)}><X /></Button>
        </div>
      )}
      {upd && (
        <button type="button" data-testid="update-pill" onClick={() => setOpen(true)} title="Neue Version von Noteforge"
          className="fixed right-4 bottom-4 z-[55] flex h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm shadow-md hover:bg-accent">
          <Download className="size-4 text-primary" />
          {state === "loading" ? `Update wird geladen … ${pct} %` : state === "ready" ? "Update wird beim Beenden installiert" : "Update verfügbar"}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>Noteforge {upd?.version}</DialogTitle>
          <DialogDescription className="sr-only">Installiert ist Version {upd?.currentVersion}. Deine Notizen bleiben unverändert.</DialogDescription>
          <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap" aria-label="Änderungen">
            {upd?.body?.trim() || "Keine Beschreibung vorhanden."}
          </div>
          {err && <p className="text-sm text-destructive">Update fehlgeschlagen: {err}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" disabled={state === "loading"} onClick={() => void installOnExit()}>Beim Beenden installieren</Button>
            <Button className="ml-auto h-11" disabled={state === "loading"} onClick={() => void installNow()}>
              {state === "loading" ? `Lädt … ${pct} %` : "Jetzt installieren und neu starten"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
