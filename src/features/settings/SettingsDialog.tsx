import { useEffect, useState } from "react";
import { AlertTriangle, Bell, CalendarDays, CheckCircle2, Cloud, DatabaseBackup, Keyboard, Monitor, Moon, Palette, PenLine, Search, Sun, Wand2, Link2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { clockText, cloud, syncNowAndApply, type CloudStatus } from "@/lib/sync";
import { usePrefs } from "@/store/prefs";
import { useTools } from "@/features/canvas/tool-store";
import { useSetup, type BarrelAction } from "@/store/setup";
import { useTheme } from "@/components/theme/theme-provider";
import { setupApi } from "@/lib/setup-api";
import { ACCENTS } from "@/features/onboarding/accents";
import { BackupSection } from "@/features/backup/BackupSection";
import { GoogleSection } from "./GoogleCalendar";
import { usePower, type PowerSetting } from "@/lib/power";

const INTERVALS = [
  { v: 0, label: "Nur manuell" }, { v: 5, label: "Alle 5 Minuten" }, { v: 15, label: "Alle 15 Minuten" },
  { v: 60, label: "Stündlich" },
];
const selectCls = "h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const clean = (e: unknown) => String(e).replace(/^Error: /, "");

function Switch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="mr-auto">
        <Label htmlFor={id}>{label}</Label>
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="flex h-11 w-16 shrink-0 items-center rounded-full px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className={cn("flex h-7 w-full items-center rounded-full p-0.5 transition-colors", checked ? "bg-primary" : "bg-muted-foreground/30")}>
          <span className={cn("size-6 rounded-full bg-white shadow transition-transform", checked && "translate-x-7")} />
        </span>
      </button>
    </div>
  );
}

type CatId = "look" | "pen" | "notify" | "sync" | "google" | "backup";
const CATS: { id: CatId; label: string; icon: React.ReactNode; words: string }[] = [
  { id: "look", label: "Darstellung", icon: <Palette />, words: "design hell dunkel system akzent farbe theme logo" },
  { id: "pen", label: "Stift & Bedienung", icon: <PenLine />, words: "stift druck kalibrierung stifttaste linkshänder rechtshänder leistung akku energie sparmodus fps tastenkürzel assistent einrichtung" },
  { id: "notify", label: "Erinnerungen", icon: <Bell />, words: "erinnerungen benachrichtigung spitz hinweise tipps vorlaufzeit" },
  { id: "sync", label: "Sync", icon: <Cloud />, words: "nextcloud sync abgleich app-passwort server ordner" },
  { id: "google", label: "Google Kalender", icon: <CalendarDays />, words: "google kalender calendar konto oauth client-id synchronisieren termine" },
  { id: "backup", label: "Sicherung", icon: <DatabaseBackup />, words: "backup sicherung sicherungen wiederherstellen aufbewahrung speicherort datenordner" },
];
const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function matches(id: CatId, q: string) {
  const c = CATS.find((x) => x.id === id)!;
  const hay = fold(`${c.label} ${c.words}`);
  return fold(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function PowerSection() {
  const p = usePower();
  const opts: { v: PowerSetting; label: string }[] = [{ v: "auto", label: "Automatisch" }, { v: "on", label: "Immer an" }, { v: "off", label: "Aus" }];
  return (
    <section className="grid gap-2 rounded-lg border p-3" aria-labelledby="pw-h">
      <h3 id="pw-h" className="font-medium">Leistungsmodus im Akkubetrieb</h3>
      <div role="radiogroup" aria-label="Leistungsmodus" className="flex flex-wrap gap-1">
        {opts.map((o) => (
          <Button key={o.v} role="radio" aria-checked={p.setting === o.v} variant={p.setting === o.v ? "secondary" : "outline"}
            className={cn("h-11", p.setting === o.v && "ring-2 ring-ring")} onClick={() => p.setSetting(o.v)}>{o.label}</Button>
        ))}
      </div>
    </section>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { accent, set } = useSetup();
  return (
    <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="look-h">
      <h3 id="look-h" className="font-medium">Darstellung</h3>
      <div role="radiogroup" aria-label="Design" className="flex gap-1">
        {([["light", "Hell", <Sun key="s" />], ["dark", "Dunkel", <Moon key="m" />], ["system", "System", <Monitor key="c" />]] as const).map(([v, l, i]) => (
          <Button key={v} role="radio" aria-checked={theme === v} variant={theme === v ? "secondary" : "outline"} className={cn("h-11 flex-1", theme === v && "ring-2 ring-ring")} onClick={() => setTheme(v)}>{i}{l}</Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Akzentfarbe">
        <button type="button" role="radio" aria-checked={!accent} aria-label="Standard-Akzentfarbe" onClick={() => set({ accent: null })}
          className={cn("size-11 rounded-full border-2 bg-foreground", !accent && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")} />
        {ACCENTS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={accent === c} aria-label={`Akzentfarbe ${c}`} onClick={() => set({ accent: c })}
            className={cn("size-11 rounded-full", accent === c && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")} style={{ background: c }} />
        ))}
      </div>
    </section>
  );
}

function PenSection() {
  const s = useSetup();
  return (
    <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="pen-h">
      <h3 id="pen-h" className="font-medium">Stift</h3>
      <div className="grid gap-1.5">
        <Label>Druckempfindlichkeit</Label>
        <div role="radiogroup" aria-label="Druckempfindlichkeit" className="flex gap-1">
          {([[0.7, "Weich"], [1, "Normal"], [1.4, "Fest"]] as const).map(([g, l]) => (
            <Button key={l} role="radio" aria-checked={s.pressureGamma === g} variant={s.pressureGamma === g ? "secondary" : "outline"}
              className={cn("h-11 flex-1", s.pressureGamma === g && "ring-2 ring-ring")} onClick={() => s.set({ pressureGamma: g })}>{l}</Button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="barrel">Stifttaste</Label>
        <select id="barrel" className={selectCls} value={s.barrel} onChange={(e) => s.set({ barrel: e.target.value as BarrelAction })}>
          <option value="lasso">Lasso</option><option value="eraser">Radierer</option><option value="radial">Radialmenü</option>
        </select>
      </div>
    </section>
  );
}

function NotifySection() {
  const s = useSetup();
  const [on, setOn] = useState(true);
  useEffect(() => { void setupApi.settings().then((x) => setOn(x["app.reminders"] !== "0")); }, []);
  return (
    <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="notify-h">
      <h3 id="notify-h" className="font-medium">Erinnerungen & Hinweise</h3>
      <Switch id="rem" label="Erinnerungen an Termine" checked={on}
        onChange={(v) => { setOn(v); void setupApi.setSetting("app.reminders", v ? "1" : "0"); }} />
      <Switch id="spitz" label="Helfer „Spitz“" checked={s.spitz}
        onChange={(v) => s.set({ spitz: v })} />
      <Button variant="outline" className="justify-self-start" disabled={!s.seenHints.length} onClick={() => s.set({ seenHints: [] })}>Alle Tipps wieder zeigen</Button>
    </section>
  );
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [st, setSt] = useState<CloudStatus | null>(null);
  const [f, setF] = useState({ server: "", username: "", password: "", folder: "Noteforge", intervalMin: 15 });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const prefs = usePrefs();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CatId>("look");
  const show = (id: CatId) => (q ? matches(id, q) : cat === id);

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
          <DialogDescription className="sr-only">Einstellungen</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Einstellungen durchsuchen" placeholder="Einstellungen durchsuchen …" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!q && (
          <nav aria-label="Kategorien" className="flex flex-wrap gap-1">
            {CATS.map((c) => (
              <Button key={c.id} variant={cat === c.id ? "secondary" : "ghost"} className={cn("h-11", cat === c.id && "ring-2 ring-ring")}
                aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.icon}{c.label}</Button>
            ))}
          </nav>
        )}
        {q && !CATS.some((c) => show(c.id)) && <p className="text-sm text-muted-foreground">Keine Einstellung gefunden.</p>}

        {show("look") && <AppearanceSection />}
        {show("pen") && <PenSection />}
        {show("notify") && <NotifySection />}

        {show("sync") && <form className="grid gap-3 rounded-lg border p-3" aria-labelledby="nc-h"
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
        </form>}

        {show("google") && <GoogleSection />}

        {show("backup") && <BackupSection />}

        {show("pen") && <PowerSection />}

        {show("pen") && <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="ui-h">
          <h3 id="ui-h" className="font-medium">Bedienung</h3>
          <Switch id="left" label="Linkshänder-Modus" checked={prefs.leftHanded} onChange={toggleLeft}
            />
          <Switch id="perf" label="Leistungsanzeige" checked={prefs.perfOverlay} onChange={prefs.setPerfOverlay}
            />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => prefs.setDialog("shortcuts")}><Keyboard /> Tastenkürzel anzeigen</Button>
            <Button variant="outline" data-testid="restart-onboarding" onClick={() => { prefs.setDialog(null); useSetup.getState().set({ done: false, step: 0 }); }}>
              <Wand2 /> Einrichtungsassistent starten
            </Button>
          </div>
        </section>}

        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>{msg.text}</p>}
      </DialogContent>
    </Dialog>
  );
}
