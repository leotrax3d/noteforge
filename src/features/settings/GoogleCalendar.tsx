// Google-Kalender: Client-ID, Konten, Einrichtung (Zielkalender, Typen, Quellkalender), Status (SPEC §8.3).
import { useEffect, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, LogIn, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_OPTS, OPT_LABELS, gcal, gcalSync, useGcal,
  type CalendarInfo, type GcalAccount, type GcalOpts, type SourceCal,
} from "@/lib/gcal";

const clean = (e: unknown) => String(e).replace(/^Error: /, "");
const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

function Check({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cn("flex min-h-11 items-center gap-3 text-sm", disabled && "opacity-50")}>
      <input id={id} type="checkbox" className="size-5 shrink-0 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Auswahl nach der Anmeldung: Zielkalender, was synchronisiert wird, welche Kalender eingeblendet werden. */
export function GoogleSetup({ account, onDone, compact }: { account: GcalAccount; onDone: (summary: string) => void; compact?: boolean }) {
  const [cals, setCals] = useState<CalendarInfo[] | null>(null);
  const [target, setTarget] = useState<string>(account.calendarId && account.calendarName !== "Noteforge – Schule" ? account.calendarId : "");
  const [opts, setOpts] = useState<GcalOpts>({ ...DEFAULT_OPTS, ...account.opts });
  const [src, setSrc] = useState<Set<string>>(new Set(account.sources.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void gcal.calendars(account.email).then(setCals).catch((e) => setErr(clean(e))); }, [account.email]);
  const writable = (cals ?? []).filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
  const others = (cals ?? []).filter((c) => c.id !== target && !(target === "" && c.summary === "Noteforge – Schule"));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const sources: SourceCal[] = (cals ?? []).filter((c) => src.has(c.id)).map((c) => ({ id: c.id, name: c.summary, color: c.backgroundColor ?? "#4285f4" }));
      await gcal.configure(account.email, target || null, opts, sources);
      const r = await gcalSync();
      const n = OPT_LABELS.filter((o) => opts[o.key] && ["exams", "events", "homework", "moodle", "timetable"].includes(o.key)).length;
      onDone(`${account.email}: ${n} Bereiche, ${sources.length} Kalender eingeblendet${r.errors.length ? " – " + r.errors.join(" · ") : ""}`);
    } catch (e) {
      setErr(clean(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3" data-testid="gcal-setup">
      <div className="grid gap-1.5">
        <Label htmlFor={`gt-${account.email}`}>Termine aus Noteforge eintragen in</Label>
        <select id={`gt-${account.email}`} value={target} onChange={(e) => setTarget(e.target.value)}
          className="h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <option value="">Eigener Kalender „Noteforge – Schule“ (empfohlen)</option>
          {writable.filter((c) => c.summary !== "Noteforge – Schule").map((c) => <option key={c.id} value={c.id}>{c.primary ? `${c.summary} (Hauptkalender)` : c.summary}</option>)}
        </select>
      </div>
      <fieldset className="grid gap-0 sm:grid-cols-2 sm:gap-x-4">
        <legend className="mb-1 text-sm font-medium">Synchronisieren</legend>
        {OPT_LABELS.map((o) => (
          <Check key={o.key} id={`go-${account.email}-${o.key}`} label={o.label} checked={opts[o.key]}
            disabled={(o.key === "examReminders" && !opts.exams) || (o.key === "homeworkAtLesson" && !opts.homework)}
            onChange={(v) => setOpts({ ...opts, [o.key]: v })} />
        ))}
      </fieldset>
      {!compact || others.length ? (
        <fieldset className="grid gap-0">
          <legend className="mb-1 text-sm font-medium">In Noteforge anzeigen (nur lesend)</legend>
          {cals == null && !err && <p className="text-sm text-muted-foreground">Lade Kalender …</p>}
          {others.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={src.has(c.id)}
                onChange={(e) => { const n = new Set(src); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSrc(n); }} />
              <span className="size-3 shrink-0 rounded-full" style={{ background: c.backgroundColor ?? "#4285f4" }} />
              <span className="truncate">{c.summary}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <Button className="justify-self-start" disabled={busy || cals == null} onClick={() => void save()}>
        <CheckCircle2 /> {busy ? "Speichere …" : "Übernehmen"}
      </Button>
    </div>
  );
}

/** Client-ID eintragen (Google Cloud Console, Typ „Desktop-App“, siehe README). */
export function ClientIdForm({ onSaved }: { onSaved?: () => void }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [has, setHas] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { void gcal.client().then((c) => { setId(c.clientId); setHas(c.hasSecret); }); }, []);
  return (
    <form className="grid gap-2" onSubmit={(e) => {
      e.preventDefault();
      void gcal.setClient(id, secret ? secret : null)
        .then(() => { setMsg({ ok: true, text: "Gespeichert." }); setSecret(""); if (secret) setHas(true); onSaved?.(); })
        .catch((x) => setMsg({ ok: false, text: clean(x) }));
    }}>
      <div className="grid gap-1.5"><Label htmlFor="g-cid">OAuth-Client-ID</Label>
        <Input id="g-cid" placeholder="…apps.googleusercontent.com" value={id} onChange={(e) => setId(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="g-sec">Client-Secret (falls angegeben)</Label>
        <Input id="g-sec" type="password" placeholder={has ? "gespeichert" : "optional"} value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline">Speichern</Button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>{msg.text}</span>}
      </div>
    </form>
  );
}

/** Anmelden + Einrichtung in einem Ablauf (Einstellungen und Assistent). */
export function GoogleConnect({ onConnected, compact }: { onConnected: (summary: string) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [acc, setAcc] = useState<GcalAccount | null>(null);
  if (acc) return <GoogleSetup account={acc} compact={compact} onDone={(s) => { setAcc(null); onConnected(s); }} />;
  return (
    <div className="grid gap-2">
      <Button className="justify-self-start" disabled={busy} onClick={() => {
        setBusy(true); setErr(null);
        void gcal.login()
          .then(async (email) => setAcc((await gcal.status()).find((a) => a.email === email) ?? null))
          .catch((e) => setErr(clean(e)))
          .finally(() => setBusy(false));
      }}>
        <LogIn /> {busy ? "Warte auf Anmeldung im Browser …" : "Mit Google anmelden"}
      </Button>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

function AccountCard({ a, onChange }: { a: GcalAccount; onChange: () => void }) {
  const [edit, setEdit] = useState(!a.calendarId);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = (k: string, fn: () => Promise<unknown>) => { setBusy(k); void fn().catch(() => {}).finally(() => { setBusy(null); onChange(); }); };
  return (
    <div className="grid gap-2 rounded-md border p-3" data-testid="gcal-account">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto truncate font-medium">{a.email}</span>
        {a.calendarId && <Button variant="ghost" size="sm" className="h-11" onClick={() => setEdit(!edit)}>{edit ? "Schließen" : "Auswahl ändern"}</Button>}
      </div>
      {a.calendarId && (
        <div className="grid gap-1 rounded-md bg-muted/50 p-2 text-sm" data-testid="gcal-state">
          <p>{a.calendarName || "Kalender"} · {a.lastSync ? `zuletzt synchronisiert ${stamp(a.lastSync)}` : "noch nicht synchronisiert"}</p>
          {a.pending > 0 && <p className="text-muted-foreground">{a.pending} Änderung{a.pending > 1 ? "en" : ""} warten auf Übertragung</p>}
          {a.lastError && <p role="alert" className="flex items-start gap-1.5 text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{a.lastError}</p>}
        </div>
      )}
      {edit && <GoogleSetup account={a} onDone={() => { setEdit(false); onChange(); }} />}
      <div className="flex flex-wrap gap-2">
        {confirm ? (
          <>
            <Button variant="destructive" disabled={!!busy} onClick={() => run("off", () => gcal.disconnect(a.email, true))}>Abmelden und Termine in Google löschen</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => run("off", () => gcal.disconnect(a.email, false))}>Nur abmelden</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Abbrechen</Button>
          </>
        ) : (
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}><Unplug /> Abmelden und Zugriff entfernen</Button>
        )}
      </div>
    </div>
  );
}

export function GoogleSection() {
  const [accs, setAccs] = useState<GcalAccount[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hasClient, setHasClient] = useState(false);
  const running = useGcal((s) => s.running);
  const rev = useGcal((s) => s.rev);
  const load = () => {
    void gcal.status().then(setAccs).catch((e) => setMsg({ ok: false, text: clean(e) }));
    void gcal.client().then((c) => setHasClient(!!c.clientId));
  };
  useEffect(load, [rev]);

  return (
    <section className="grid gap-3 rounded-lg border p-3" aria-labelledby="gc-h">
      <div className="flex items-center gap-2">
        <CalendarPlus className="size-5 text-muted-foreground" />
        <h3 id="gc-h" className="mr-auto font-medium">Google Kalender</h3>
      </div>
      <details className="rounded-md border px-3 py-1" open={!hasClient}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Google-Cloud-Zugang</summary>
        <div className="pb-3"><ClientIdForm onSaved={load} /></div>
      </details>
      {accs?.map((a) => <AccountCard key={a.email} a={a} onChange={load} />)}
      {adding
        ? <GoogleConnect onConnected={(s) => { setAdding(false); setMsg({ ok: true, text: `Verbunden: ${s}` }); load(); }} />
        : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!hasClient} onClick={() => setAdding(true)}><LogIn /> {accs?.length ? "Weiteres Konto hinzufügen" : "Google-Konto verbinden"}</Button>
            {!!accs?.some((a) => a.calendarId) && (
              <Button variant="outline" disabled={running} onClick={() => {
                setMsg(null);
                void gcalSync().then((r) => {
                  const parts = [r.pushed && `${r.pushed} übertragen`, r.deleted && `${r.deleted} gelöscht`, r.pulled && `${r.pulled} übernommen`,
                    r.conflicts && `${r.conflicts} Konflikt${r.conflicts > 1 ? "e" : ""}`].filter(Boolean);
                  setMsg(r.errors.length ? { ok: false, text: r.errors.join(" · ") } : { ok: true, text: parts.length ? parts.join(", ") + "." : "Alles aktuell." });
                }).catch((e) => setMsg({ ok: false, text: clean(e) })).finally(load);
              }}>
                <RefreshCw className={running ? "animate-spin" : undefined} /> Jetzt synchronisieren
              </Button>
            )}
          </div>
        )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>{msg.text}</p>}
    </section>
  );
}
