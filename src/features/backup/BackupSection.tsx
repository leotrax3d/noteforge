// Einstellungen → Sicherungen: Ordner, Aufbewahrung, Liste, Vorschau, Wiederherstellen (komplett/Fach/Blatt).
import { useEffect, useRef, useState } from "react";
import { DatabaseBackup, FolderOpen, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtBytes } from "@/lib/sync";
import { elementToStroke } from "@/canvas/core/codec";
import { drawStroke } from "@/canvas/core/pens";
import { elementToObj, type ImageObj } from "@/canvas/core/objects";
import { drawImageObj } from "@/canvas/core/engine";
import { backupApi, type BackupState, type PreviewSubject, type RestoreScope } from "./backup-api";

const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const clean = (e: unknown) => String(e).replace(/^Error: /, "");
const label = (name: string) => {
  const m = /noteforge-(vor-wiederherstellung-)?(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?/.exec(name);
  if (!m) return name;
  const d = `${m[4]}.${m[3]}.${m[2]}${m[5] ? ` ${m[5]}:${m[6]}` : ""}`;
  return m[1] ? `${d} (vor Wiederherstellung)` : d;
};

function Count({ id, text, value, onChange }: { id: string; text: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{text}</Label>
      <input id={id} type="number" min={0} max={60} value={value} className="h-11 w-full rounded-md border bg-background px-3"
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(Math.max(0, Math.min(60, e.target.valueAsNumber)))} />
    </div>
  );
}

/** Kleines Vorschaubild eines Blatts aus der Sicherung. */
function PagePreview({ backup, pageId }: { backup: string; pageId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [msg, setMsg] = useState("Lädt …");
  useEffect(() => {
    let off = false;
    void backupApi.pageElements(backup, pageId).then(async (els) => {
      const c = ref.current;
      if (off || !c) return;
      const strokes = els.map(elementToStroke).filter((s) => !!s);
      const objs = els.map(elementToObj).filter((o): o is ImageObj => o?.kind === "image");
      const all = [...strokes.map((s) => s!.bbox), ...objs.map((o) => o.bbox)];
      if (!all.length) return setMsg("Leeres Blatt");
      const x0 = Math.min(...all.map((b) => b.x)), y0 = Math.min(...all.map((b) => b.y));
      const x1 = Math.max(...all.map((b) => b.x + b.w)), y1 = Math.max(...all.map((b) => b.y + b.h));
      const k = Math.min(c.width / (x1 - x0), c.height / (y1 - y0));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      const imgs = await Promise.all(objs.map((o) => new Promise<HTMLImageElement>((r) => { const i = new Image(); i.onload = i.onerror = () => r(i); i.src = o.data.src; })));
      objs.forEach((o, i) => drawImageObj(ctx, o, imgs[i]));
      for (const s of strokes) drawStroke(ctx, s!, false);
      setMsg("");
    }).catch((e) => setMsg(clean(e)));
    return () => { off = true; };
  }, [backup, pageId]);
  return (
    <div className="relative">
      <canvas ref={ref} width={360} height={240} className="w-full rounded border" aria-label="Vorschau des Blatts aus der Sicherung" />
      {msg && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}

function RestoreDialog({ name, onClose, onDone }: { name: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [tree, setTree] = useState<PreviewSubject[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<{ subjects: Set<string>; pages: Set<string> }>({ subjects: new Set(), pages: new Set() });
  const [view, setView] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTree(null); setErr(null); setView(null); setPick({ subjects: new Set(), pages: new Set() });
    if (name) void backupApi.preview(name).then(setTree).catch((e) => setErr(clean(e)));
  }, [name]);
  const toggle = (k: "subjects" | "pages", id: string) => setPick((p) => {
    const n = new Set(p[k]);
    if (n.has(id)) n.delete(id); else n.add(id);
    return { ...p, [k]: n };
  });
  const run = async (scope: RestoreScope, what: string) => {
    if (!name) return;
    if (scope.all && !window.confirm("Wirklich alles auf den Stand dieser Sicherung zurücksetzen? Der aktuelle Stand wird vorher gesichert.")) return;
    setBusy(true);
    try {
      const n = await backupApi.restore(name, scope);
      onDone(`${what} wiederhergestellt (${n} ${n === 1 ? "Blatt" : "Blätter"}). Der vorherige Stand wurde gesichert.`);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErr(clean(e));
    } finally {
      setBusy(false);
    }
  };
  const nSel = pick.subjects.size + pick.pages.size;
  const curText = { same: "unverändert", changed: "heute anders", missing: "fehlt heute" } as const;
  return (
    <Dialog open={!!name} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl" data-testid="restore-dialog">
        <DialogTitle>Wiederherstellen: {name && label(name)}</DialogTitle>
        <DialogDescription className="sr-only">Wähle Fächer oder einzelne Blätter – oder stelle alles wieder her. Tippe auf ein Blatt für die Vorschau.</DialogDescription>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!tree && !err && <p className="text-sm text-muted-foreground">Sicherung wird gelesen …</p>}
        {tree && (
          <div className="grid gap-3 sm:grid-cols-[1fr_360px]">
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" aria-label="Inhalt der Sicherung">
              {tree.map((s) => (
                <li key={s.id}>
                  <label className="flex h-11 items-center gap-2 font-medium">
                    <input type="checkbox" className="size-5" checked={pick.subjects.has(s.id)} onChange={() => toggle("subjects", s.id)} />
                    <span className="size-3 rounded-full" style={{ background: s.color }} /> {s.name}
                  </label>
                  {s.sections.map((sec) => (
                    <div key={sec.id} className="ml-7">
                      <p className="text-xs text-muted-foreground">{sec.name}</p>
                      {sec.pages.map((p) => (
                        <div key={p.id} className={cn("flex min-h-11 items-center gap-2 rounded px-1", view === p.id && "bg-accent")}>
                          <input type="checkbox" aria-label={`Blatt ${p.title} auswählen`} className="size-5" disabled={pick.subjects.has(s.id)}
                            checked={pick.subjects.has(s.id) || pick.pages.has(p.id)} onChange={() => toggle("pages", p.id)} />
                          <button type="button" className="flex-1 truncate text-left text-sm" onClick={() => setView(p.id)}>{p.title}</button>
                          <span className={cn("text-xs", p.current === "same" ? "text-muted-foreground" : "text-amber-600")}>{curText[p.current]} · {p.elements} El.</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            <div>{view && name ? <PagePreview backup={name} pageId={view} /> : <p className="py-10 text-center text-sm text-muted-foreground">Blatt antippen für die Vorschau</p>}</div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 text-destructive" disabled={busy || !tree} onClick={() => void run({ all: true }, "Alles")}><RotateCcw /> Alles wiederherstellen</Button>
          <Button className="ml-auto h-11" disabled={busy || !nSel}
            onClick={() => void run({ subjects: [...pick.subjects], pages: [...pick.pages] }, nSel === 1 ? "Auswahl" : `${nSel} Einträge`)}>
            <History /> Auswahl wiederherstellen{nSel ? ` (${nSel})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BackupSection() {
  const [st, setSt] = useState<BackupState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  useEffect(() => { void backupApi.state().then(setSt).catch((e) => setMsg(clean(e))); }, []);
  const save = (cfg: Partial<BackupState["config"]>) => st && void backupApi.setConfig({ ...st.config, ...cfg }).then(setSt).catch((e) => setMsg(clean(e)));
  return (
    <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="bk-h" data-testid="backup-section">
      <div className="flex items-center gap-2">
        <DatabaseBackup className="size-5 text-muted-foreground" />
        <h3 id="bk-h" className="mr-auto font-medium">Sicherungen</h3>
        <Button variant="outline" className="h-11" onClick={() => void backupApi.create().then((s) => { setSt(s); setMsg("Sicherung erstellt."); }).catch((e) => setMsg(clean(e)))}>Jetzt sichern</Button>
      </div>
      <p className="text-xs text-muted-foreground"><span className="font-mono break-all">{st?.dir || "–"}</span></p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11" onClick={() => void backupApi.pickDir().then((d) => d && save({ dir: d }))}><FolderOpen /> Ordner wählen …</Button>
        {st?.config.dir && <Button variant="ghost" className="h-11" onClick={() => save({ dir: null })}>Standardordner</Button>}
      </div>
      {st && (
        <div className="grid grid-cols-3 gap-2">
          <Count id="bk-d" text="Tägliche behalten" value={st.config.daily} onChange={(daily) => save({ daily: Math.max(1, daily) })} />
          <Count id="bk-w" text="Wöchentliche" value={st.config.weekly} onChange={(weekly) => save({ weekly })} />
          <Count id="bk-m" text="Monatliche" value={st.config.monthly} onChange={(monthly) => save({ monthly })} />
        </div>
      )}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {st?.backups.length ? (
        <ul className="grid max-h-64 gap-1 overflow-y-auto text-sm" aria-label="Sicherungen">
          {st.backups.map((b) => (
            <li key={b.name} className="flex items-center gap-2">
              <span className="flex-1 truncate">{label(b.name)}</span>
              <span className="text-xs text-muted-foreground">{fmtBytes(b.size)} · {stamp(b.created)}</span>
              <Button variant="ghost" className="h-11" onClick={() => setRestore(b.name)}>Wiederherstellen …</Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Noch keine Sicherung{st && !st.dir ? " (nur in der Windows-App)" : ""}.</p>}
      <RestoreDialog name={restore} onClose={() => setRestore(null)} onDone={(m) => { setRestore(null); setMsg(m); }} />
    </section>
  );
}
