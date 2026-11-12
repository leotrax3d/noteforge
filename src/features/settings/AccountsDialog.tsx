import { useEffect, useState } from "react";
import { CheckCircle2, Link2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { integrations, syncNow, useSyncRev, type IntegrationStatus } from "@/lib/integrations";
import { fmtDate, fmtTime } from "@/features/calendar/dates";

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
          <DialogDescription>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="u-server">Server</Label>
              <Input id="u-server" placeholder="z. B. neilo.webuntis.com" value={u.server} onChange={(e) => setU({ ...u, server: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="u-school">Schule (Kürzel)</Label>
              <Input id="u-school" placeholder="wie in der WebUntis-Adresse" value={u.school} onChange={(e) => setU({ ...u, school: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="u-user">Benutzername</Label>
              <Input id="u-user" autoComplete="username" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="u-pw">Passwort</Label>
              <Input id="u-pw" type="password" autoComplete="current-password" placeholder={st?.untis ? "gespeichert" : ""} value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Server und Schule stehen in der Adresszeile, wenn du WebUntis im Browser öffnest (…webuntis.com/WebUntis/?school=<b>kürzel</b>).</p>
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
            <Input id="m-url" placeholder="https://…moodle.schule-bw.de" value={m.url} onChange={(e) => setM({ ...m, url: e.target.value })} /></div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={useToken} onChange={(e) => setUseToken(e.target.checked)} />
            Mit Token anmelden (für Konten mit Schul-Login/SSO)
          </label>
          {useToken ? (
            <div className="grid gap-1.5"><Label htmlFor="m-token">Token</Label>
              <Input id="m-token" type="password" value={m.token} onChange={(e) => setM({ ...m, token: e.target.value })} />
              <p className="text-xs text-muted-foreground">In Moodle unter Profil → Einstellungen → Sicherheitsschlüssel („Moodle mobile web service“).</p></div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="m-user">Benutzername</Label>
                <Input id="m-user" autoComplete="username" value={m.username} onChange={(e) => setM({ ...m, username: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="m-pw">Passwort</Label>
                <Input id="m-pw" type="password" autoComplete="current-password" placeholder={st?.moodle ? "gespeichert" : ""} value={m.password} onChange={(e) => setM({ ...m, password: e.target.value })} /></div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!!busy}><Link2 /> {busy === "moodle" ? "Verbinde …" : st?.moodle ? "Neu verbinden" : "Verbinden"}</Button>
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
