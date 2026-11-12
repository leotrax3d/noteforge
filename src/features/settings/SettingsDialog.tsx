import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, DatabaseBackup, Keyboard, Link2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { clockText, cloud, fmtBytes, syncNowAndApply, type CloudStatus } from "@/lib/sync";
import { usePrefs } from "@/store/prefs";
import { useTools } from "@/features/canvas/tool-store";

const INTERVALS = [
  { v: 0, label: "Nur manuell" }, { v: 5, label: "Alle 5 Minuten" }, { v: 15, label: "Alle 15 Minuten" },
  { v: 60, label: "Stündlich" },
];
const selectCls = "h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const clean = (e: unknown) => String(e).replace(/^Error: /, "");

function Switch({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="mr-auto">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="flex h-11 w-16 shrink-0 items-center rounded-full px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className={cn("flex h-7 w-full items-center rounded-full p-0.5 transition-colors", checked ? "bg-primary" : "bg-muted-foreground/30")}>
          <span className={cn("size-6 rounded-full bg-white shadow transition-transform", checked && "translate-x-6")} />
        </span>
      </button>
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [st, setSt] = useState<CloudStatus | null>(null);
  const [f, setF] = useState({ server: "", username: "", password: "", folder: "Noteforge", intervalMin: 15 });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const prefs = usePrefs();

  const load = async () => {
    const s = await cloud.status();
    setSt(s);
    if (s.config) setF((x) => ({ ...x, ...s.config!, password: "" }));
  };
  useEffect(() => {
    if (open) { setMsg(null); void load().catch((e) => setMsg({ ok: false, text: clean(e) })); }
  }, [open]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: clean(e) });
    } finally {
      setBusy(null);
      await load().catch(() => {});
    }
  };

  const syncText = async () => {
    const r = await syncNowAndApply();
    if (!r) return "Es läuft bereits ein Abgleich.";
    const parts = [
      r.uploaded && `${r.uploaded} hochgeladen`, r.downloaded && `${r.downloaded} übernommen`,
      r.deleted && `${r.deleted} gelöscht`, r.conflicts && `${r.conflicts} Konflikt${r.conflicts > 1 ? "e" : ""} gelöst`,
    ].filter(Boolean);
    return `Abgeglichen${parts.length ? ": " + parts.join(", ") : " – alles aktuell"}.`;
  };

  const last = st?.last;
  const off = last?.clockOffsetMs ?? null;
  const skewed = off != null && st && Math.abs(off) >= st.clockWarnMs;

  const toggleLeft = (v: boolean) => {
    prefs.setLeftHanded(v);
    // Senkrecht angedockte Werkzeugleiste auf die andere Seite spiegeln
    const t = useTools.getState();
    if (v !== prefs.leftHanded && (t.dock === "left" || t.dock === "right")) t.setDock(t.dock === "left" ? "right" : "left");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>Sync, Sicherung und Bedienung auf diesem Gerät.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-3 rounded-lg border p-3" aria-labelledby="nc-h"
          onSubmit={(e) => {
            e.preventDefault();
            void run("connect", async () => {
              await cloud.connect(f);
              setF((x) => ({ ...x, password: "" }));
              return `Mit Nextcloud verbunden. ${await syncText()}`;
            });
          }}>
          <div className="flex items-center gap-2">
            <Cloud className="size-5 text-muted-foreground" />
            <h3 id="nc-h" className="mr-auto font-medium">Nextcloud-Sync</h3>
            {st?.config && <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> verbunden</span>}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="nc-server">Server</Label>
            <Input id="nc-server" inputMode="url" placeholder="https://cloud.example.de" value={f.server} onChange={(e) => setF({ ...f, server: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="nc-user">Benutzername</Label>
              <Input id="nc-user" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nc-pw">App-Passwort</Label>
              <Input id="nc-pw" type="password" autoComplete="current-password" placeholder={st?.config ? "gespeichert" : ""} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nc-folder">Ordner</Label>
              <Input id="nc-folder" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nc-int">Automatisch</Label>
              <select id="nc-int" className={selectCls} value={f.intervalMin} onChange={(e) => setF({ ...f, intervalMin: Number(e.target.value) })}>
                {INTERVALS.map((i) => <option key={i.v} value={i.v}>{i.label}</option>)}
              </select></div>
          </div>
          <p className="text-xs text-muted-foreground">
            App-Passwort in Nextcloud unter Einstellungen → Sicherheit → „Neues App-Passwort“ erzeugen. Es liegt nur in der
            Windows-Anmeldeinformationsverwaltung. Konflikte werden pro Blatt gelöst: die neuere Version gewinnt, die ältere bleibt als Seitenversion.
          </p>

          {st?.config && (
            <div className="grid gap-1 rounded-md bg-muted/50 p-2 text-sm" data-testid="sync-state">
              <p>{last ? `Zuletzt abgeglichen ${stamp(last.finishedAt)} · Gerät „${st.device}“` : "Noch nicht abgeglichen"}</p>
              {off != null && (
                <p className={cn("flex items-start gap-1.5", skewed ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} data-testid="clock">
                  {skewed && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                  <span>
                    {skewed
                      ? `${clockText(off)} als die Nextcloud. Noteforge rechnet beim Abgleich in Serverzeit um – bitte trotzdem in Windows „Uhrzeit jetzt synchronisieren“ ausführen.`
                      : "Uhrzeit stimmt mit der Nextcloud überein."}
                  </span>
                </p>
              )}
              {(st.lastError || last?.errors.length) ? (
                <p role="alert" className="text-destructive">{st.lastError ?? last!.errors.join(" · ")}</p>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!!busy}><Link2 /> {busy === "connect" ? "Verbinde …" : st?.config ? "Speichern" : "Verbinden"}</Button>
            {st?.config && <>
              <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run("sync", syncText)}>
                <RefreshCw className={busy === "sync" ? "animate-spin" : undefined} /> Jetzt synchronisieren
              </Button>
              <Button type="button" variant="ghost" className="text-destructive" disabled={!!busy}
                onClick={() => void run("off", async () => { await cloud.disconnect(); setF((x) => ({ ...x, password: "" })); return "Sync getrennt. Lokale Daten bleiben erhalten."; })}>
                <Unplug /> Trennen
              </Button>
            </>}
          </div>
        </form>

        <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="bk-h">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="size-5 text-muted-foreground" />
            <h3 id="bk-h" className="mr-auto font-medium">Backup</h3>
            <Button variant="outline" disabled={!!busy} onClick={() => void run("backup", async () => { await cloud.backupNow(); return "Backup erstellt."; })}>Jetzt sichern</Button>
          </div>
          <p className="text-xs text-muted-foreground">Täglich automatisch, die letzten 14 bleiben erhalten. Ordner: <span className="font-mono break-all">{st?.backupDir}</span></p>
          {st?.backups.length ? (
            <ul className="grid gap-1 text-sm" aria-label="Backups">
              {st.backups.slice(0, 5).map((b) => (
                <li key={b.name} className="flex justify-between gap-2"><span className="truncate font-mono text-xs">{b.name}</span><span className="text-muted-foreground">{fmtBytes(b.size)}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Noch kein Backup.</p>}
        </section>

        <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="ui-h">
          <h3 id="ui-h" className="font-medium">Bedienung</h3>
          <Switch id="left" label="Linkshänder-Modus" checked={prefs.leftHanded} onChange={toggleLeft}
            hint="Seitenleiste rechts, senkrechte Werkzeugleiste gespiegelt – Bedienelemente auf der Seite der freien Hand." />
          <Switch id="perf" label="Leistungsanzeige" checked={prefs.perfOverlay} onChange={prefs.setPerfOverlay}
            hint="FPS, Frame-Zeit und Stift-Latenz auf dem Blatt (Strg+Umschalt+P)." />
          <Button variant="outline" className="justify-self-start" onClick={() => prefs.setDialog("shortcuts")}><Keyboard /> Tastenkürzel anzeigen</Button>
        </section>

        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>{msg.text}</p>}
      </DialogContent>
    </Dialog>
  );
}
