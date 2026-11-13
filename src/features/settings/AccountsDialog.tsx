import { useEffect, useState } from "react";
import { CheckCircle2, Link2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { integrations, syncNow, useSyncRev, type IntegrationStatus } from "@/lib/integrations";
import { fmtDate, fmtTime } from "@/features/calendar/dates";
import { setupApi, type School } from "@/lib/setup-api";

/** Schulsuche wie im Einrichtungsassistenten: füllt Server und Schulkürzel automatisch. */
function SchoolPicker({ onPick }: { onPick: (s: School) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<School[]>([]);
  const [info, setInfo] = useState("");
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); setInfo(""); return; }
    const t = window.setTimeout(() => {
      setInfo("Suche …");
      void setupApi.searchSchools(q).then((r) => { setHits(r); setInfo(r.length ? "" : "Keine Schule gefunden"); })
        .catch((e) => setInfo(String(e).replace(/^Error: /, "")));
    }, 400);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="u-search">Schule suchen</Label>
      <Input id="u-search" placeholder="Name oder Ort der Schule" value={q} onChange={(e) => setQ(e.target.value)} />
      {info && <p className="text-sm text-muted-foreground">{info}</p>}
      {hits.slice(0, 6).map((h) => (
        <button key={`${h.server}/${h.login}`} type="button" onClick={() => { onPick(h); setQ(""); setHits([]); }}
          className="flex min-h-11 w-full items-center gap-2 truncate rounded-md border px-3 text-left text-sm hover:bg-accent">
          <b className="truncate">{h.name}</b> <span className="truncate text-muted-foreground">{h.address}</span>
        </button>
      ))}
    </div>
  );
}

const when = (t: number | null) => (t ? `zuletzt abgeglichen ${fmtDate(t, false)}, ${fmtTime(t)}` : "noch nicht abgeglichen");

/** Konten für WebUntis und Moodle BW. Passwörter gehen direkt an das Backend (Credential Manager). */
export function AccountsDialog({ open, onOpenChange, onMapping }: { open: boolean; onOpenChange: (o: boolean) => void; onMapping: () => void }) {
  const [st, setSt] = useState<IntegrationStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const bump = useSyncRev((s) => s.bump);
  const [u, setU] = useState({ server: "", school: "", username: "", password: "" });
  const [m, setM] = useState({ url: "", username: "", password: "", token: "" });
  const [useToken, setUseToken] = useState(false);
  const [sso, setSso] = useState<boolean | null>(null);
  // Anmeldeart der Moodle-Seite erkennen (Schul-Login wie Schule@BW → kein Passwortfeld)
  useEffect(() => {
    if (!m.url.trim()) { setSso(null); return; }
    let stop = false;
    const t = window.setTimeout(() => {
      void integrations.moodleLoginType(m.url).then((k) => !stop && setSso(k == null ? null : k !== 1), () => !stop && setSso(null));
    }, 500);
    return () => { stop = true; window.clearTimeout(t); };
  }, [m.url]);
  const ssoLogin = () => void run("moodle", async () => {
    const r = await integrations.moodleSsoConnect(m.url);
    return `Moodle verbunden – ${r.deadlines ?? 0} anstehende Abgaben übernommen.`;
  });
  const [manual, setManual] = useState(false);
  const [schoolName, setSchoolName] = useState("");

  const load = async () => {
    const s = await integrations.status();
    setSt(s);
    if (s.untis) setU((x) => ({ ...x, ...s.untis, password: "" }));
    if (s.moodle) setM((x) => ({ ...x, ...s.moodle, password: "", token: "" }));
  };
  useEffect(() => {
    if (open) { setMsg(null); void load().catch((e) => setMsg({ ok: false, text: String(e) })); }
  }, [open]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label); setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      bump();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: String(e).replace(/^Error: /, "") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Konten</DialogTitle>
          <DialogDescription className="sr-only">
            Stundenplan aus WebUntis, Abgaben und Dateien aus Moodle BW. Passwörter und Tokens liegen nur in der Windows-Anmeldeinformationsverwaltung.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-3 rounded-lg border p-3" aria-labelledby="untis-h"
          onSubmit={(e) => {
            e.preventDefault();
            void run("untis", async () => {
              const r = await integrations.untisConnect(u.server, u.school, u.username, u.password);
              setU((x) => ({ ...x, password: "" }));
              return `WebUntis verbunden – ${r.lessons ?? 0} Stunden geladen.`;
            });
          }}>
          <div className="flex items-center gap-2">
            <h3 id="untis-h" className="mr-auto font-medium">WebUntis</h3>
            {st?.untis && <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> verbunden · {when(st.untisLastSync)}</span>}
          </div>
          {u.server && u.school && !manual ? (
            <div className="flex min-h-11 items-center gap-2 rounded-md bg-muted/50 px-3 text-sm">
              <span className="mr-auto truncate"><b>{schoolName || u.school}</b> <span className="text-muted-foreground">{u.server}</span></span>
              <Button type="button" variant="ghost" className="h-11" onClick={() => { setU({ ...u, server: "", school: "" }); setSchoolName(""); }}>Ändern</Button>
            </div>
          ) : !manual && <SchoolPicker onPick={(h) => { setU({ ...u, server: h.server, school: h.login }); setSchoolName(h.name); }} />}
          {!manual && !(u.server && u.school) && (
            <Button type="button" variant="link" className="h-11 justify-self-start px-0" onClick={() => setManual(true)}>Server manuell eingeben</Button>
          )}
          <div className="grid grid-cols-2 gap-3">
            {manual && <>
            <div className="grid gap-1.5"><Label htmlFor="u-server">Server</Label>
              <Input id="u-server" placeholder="z. B. neilo.webuntis.com" value={u.server} onChange={(e) => setU({ ...u, server: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="u-school">Schule (Kürzel)</Label>
              <Input id="u-school" placeholder="wie in der WebUntis-Adresse" value={u.school} onChange={(e) => setU({ ...u, school: e.target.value })} /></div>
            </>}
            <div className="grid gap-1.5"><Label htmlFor="u-user">Benutzername</Label>
              <Input id="u-user" autoComplete="username" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="u-pw">Passwort</Label>
              <Input id="u-pw" type="password" autoComplete="current-password" placeholder={st?.untis ? "gespeichert" : ""} value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!!busy}><Link2 /> {busy === "untis" ? "Verbinde …" : st?.untis ? "Neu verbinden" : "Verbinden"}</Button>
            {st?.untis && (
              <Button type="button" variant="outline" disabled={!!busy}
                onClick={() => void run("untis-off", async () => { await integrations.untisDisconnect(); setU({ server: "", school: "", username: "", password: "" }); return "WebUntis getrennt."; })}>
                <Unplug /> Trennen
              </Button>
            )}
          </div>
        </form>

        <form className="grid gap-3 rounded-lg border p-3" aria-labelledby="moodle-h"
          onSubmit={(e) => {
            e.preventDefault();
            void run("moodle", async () => {
              const r = await integrations.moodleConnect(m.url, m.username, useToken ? "" : m.password, useToken ? m.token : null);
              setM((x) => ({ ...x, password: "", token: "" }));
              return `Moodle verbunden – ${r.deadlines ?? 0} anstehende Abgaben übernommen.`;
            });
          }}>
          <div className="flex items-center gap-2">
            <h3 id="moodle-h" className="mr-auto font-medium">Moodle BW</h3>
            {st?.moodle && <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" /> verbunden · {when(st.moodleLastSync)}</span>}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="m-url">Moodle-Adresse</Label>
            <Input id="m-url" placeholder="z. B. https://…moodle.bw.schule" value={m.url} onChange={(e) => setM({ ...m, url: e.target.value })} /></div>
          <Button type="button" variant={sso ? "default" : "outline"} disabled={!!busy || !m.url.trim()} onClick={ssoLogin} data-testid="moodle-sso">
            <Link2 /> {busy === "moodle" && sso ? "Anmeldefenster offen …" : "Mit Schul-Login anmelden (Schule@BW)"}
          </Button>
          {sso && <p className="text-sm text-muted-foreground">Diese Moodle-Seite meldet über den Schul-Login an. Es öffnet sich ein Fenster; dein Passwort sieht Noteforge nicht.</p>}
          {!sso && <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={useToken} onChange={(e) => setUseToken(e.target.checked)} />
            Mit Token anmelden (für Konten mit Schul-Login/SSO)
          </label>
          {useToken ? (
            <div className="grid gap-1.5"><Label htmlFor="m-token">Token</Label>
              <Input id="m-token" type="password" value={m.token} onChange={(e) => setM({ ...m, token: e.target.value })} /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="m-user">Benutzername</Label>
                <Input id="m-user" autoComplete="username" value={m.username} onChange={(e) => setM({ ...m, username: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="m-pw">Passwort</Label>
                <Input id="m-pw" type="password" autoComplete="current-password" placeholder={st?.moodle ? "gespeichert" : ""} value={m.password} onChange={(e) => setM({ ...m, password: e.target.value })} /></div>
            </div>
          )}
          </>}
          <div className="flex flex-wrap gap-2">
            {!sso && <Button type="submit" disabled={!!busy}><Link2 /> {busy === "moodle" ? "Verbinde …" : st?.moodle ? "Neu verbinden" : "Verbinden"}</Button>}
            {st?.moodle && (
              <Button type="button" variant="outline" disabled={!!busy}
                onClick={() => void run("moodle-off", async () => { await integrations.moodleDisconnect(); setM({ url: "", username: "", password: "", token: "" }); return "Moodle getrennt."; })}>
                <Unplug /> Trennen
              </Button>
            )}
          </div>
        </form>

        {msg && <p role="status" className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-destructive"}>{msg.text}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" disabled={!!busy || (!st?.untis && !st?.moodle)}
            onClick={() => void run("sync", async () => {
              const r = await syncNow(true);
              if (r.errors.length) throw new Error(r.errors.join("\n"));
              return "Abgleich abgeschlossen.";
            })}>
            <RefreshCw className={busy === "sync" ? "animate-spin" : ""} /> Jetzt abgleichen
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={!st?.untis && !st?.moodle} onClick={onMapping}>Fächer zuordnen …</Button>
            <Button type="button" onClick={() => onOpenChange(false)}>Fertig</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
