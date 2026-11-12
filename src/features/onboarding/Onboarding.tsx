// Einrichtungsassistent beim ersten Start (fortsetzbar, jeder optionale Schritt überspringbar).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, Check, CheckCircle2, Cloud, FileUp, FolderOpen, GraduationCap,
  Hand, Monitor, Moon, PenLine, School, Sparkles, Sun,
} from "lucide-react";
import { getStroke } from "perfect-freehand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/common/Logo";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";
import { api, putAsset } from "@/lib/api";
import { integrations, suggestMatch, useSyncRev, type UntisSubject } from "@/lib/integrations";
import { cloud } from "@/lib/sync";
import { requestNotifications, setupApi, type DirCheck, type School as SchoolHit } from "@/lib/setup-api";
import { SUBJECT_COLORS } from "@/lib/catalog";
import { objToElement } from "@/canvas/core/objects";
import { outlinePath } from "@/canvas/core/pens";
import { layoutPdfPages, orientationOf, pdfToImages } from "@/features/pages/pdf-import";
import { usePrefs } from "@/store/prefs";
import { useSetup, type BarrelAction } from "@/store/setup";
import type { PageBackground, PageMode, Subject } from "@/lib/types";

const STEPS = [
  "Willkommen", "Speicherort", "Stift & Hand", "Standard-Blatt", "WebUntis", "Moodle", "Nextcloud", "OneNote", "Erinnerungen", "Fertig",
] as const;
/** Pflichtschritte ohne „Überspringen“ */
const REQUIRED = new Set([0, 9]);

import { ACCENTS } from "./accents";

const clean = (e: unknown) => String(e).replace(/^Error: /, "");

/** Ergebnisse der Schritte für die Zusammenfassung (nur Anzeige). */
type Summary = Partial<Record<(typeof STEPS)[number], string>>;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const setup = useSetup();
  const step = Math.min(setup.step, STEPS.length - 1);
  const [summary, setSummary] = useState<Summary>({});
  const [restart, setRestart] = useState(false);
  const note = (k: keyof Summary, v: string) => setSummary((s) => ({ ...s, [k]: v }));
  const go = (n: number) => setup.set({ step: Math.max(0, Math.min(STEPS.length - 1, n)) });
  const skip = () => { if (!summary[STEPS[step]]) note(STEPS[step], "übersprungen"); go(step + 1); };

  const finish = async () => {
    setup.set({ done: true, step: 0 });
    if (restart) await setupApi.restart();
    onDone();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ob-title" data-testid="onboarding"
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Logo size={32} />
        <span className="font-semibold">Noteforge einrichten</span>
        <span className="ml-auto text-sm text-muted-foreground" aria-live="polite">Schritt {step + 1} von {STEPS.length}: {STEPS[step]}</span>
      </header>
      {/* Fortschritt: antippbare Punkte für erledigte Schritte */}
      <nav aria-label="Fortschritt" className="flex gap-1 px-4 pt-3">
        {STEPS.map((s, i) => (
          <button key={s} type="button" aria-label={`${s}${i < step ? " (erledigt)" : ""}`} aria-current={i === step ? "step" : undefined}
            disabled={i > step} onClick={() => go(i)}
            className="flex h-11 flex-1 items-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className={cn("h-1.5 w-full rounded-full", i < step ? "bg-primary" : i === step ? "bg-primary/60" : "bg-muted")} />
          </button>
        ))}
      </nav>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-4 py-6">
        <h1 id="ob-title" className="mb-4 text-2xl font-semibold">{TITLES[step]}</h1>
        {step === 0 && <WelcomeStep />}
        {step === 1 && <LocationStep onSaved={(p, rs) => { note("Speicherort", p); if (rs) setRestart(true); }} />}
        {step === 2 && <PenStep note={(v) => note("Stift & Hand", v)} />}
        {step === 3 && <PageStep />}
        {step === 4 && <UntisStep note={(v) => note("WebUntis", v)} />}
        {step === 5 && <MoodleStep note={(v) => note("Moodle", v)} />}
        {step === 6 && <CloudStep note={(v) => note("Nextcloud", v)} />}
        {step === 7 && <OneNoteStep note={(v) => note("OneNote", v)} />}
        {step === 8 && <ReminderStep note={(v) => note("Erinnerungen", v)} />}
        {step === 9 && <SummaryStep summary={summary} restart={restart} />}
      </main>

      <footer className="flex items-center gap-2 border-t px-4 py-3">
        <Button variant="outline" size="lg" disabled={step === 0} onClick={() => go(step - 1)}><ArrowLeft /> Zurück</Button>
        <span className="mr-auto" />
        {!REQUIRED.has(step) && <Button variant="ghost" size="lg" onClick={skip}>Überspringen</Button>}
        {step < STEPS.length - 1
          ? <Button size="lg" data-testid="ob-next" onClick={() => go(step + 1)}>Weiter <ArrowRight /></Button>
          : <Button size="lg" data-testid="ob-finish" onClick={() => void finish()}><Check /> {restart ? "Neu starten und loslegen" : "Los geht’s"}</Button>}
      </footer>
    </div>
  );
}

const TITLES = [
  "Willkommen bei Noteforge", "Wo sollen deine Notizen liegen?", "Stift & Hand", "Dein Standard-Blatt",
  "Schule & WebUntis", "Moodle / Schule BW", "Nextcloud-Sync", "OneNote-Import", "Erinnerungen & Helfer Spitz", "Fertig!",
];

// ---------- Bausteine ----------

function Choice({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button type="button" aria-pressed={active} aria-label={label} onClick={onClick}
      className={cn("flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}>
      {children}
    </button>
  );
}

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? "status" : "alert"} className={cn("text-sm", m.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{m.text}</p>;
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); return true; } catch (e) { setMsg({ ok: false, text: clean(e) }); return false; } finally { setBusy(false); }
  };
  return { busy, msg, run };
}

// ---------- 1 Willkommen + Design ----------

function WelcomeStep() {
  const { theme, setTheme } = useTheme();
  const { accent, set } = useSetup();
  const themes: [Theme, string, ReactNode][] = [["light", "Hell", <Sun key="s" />], ["dark", "Dunkel", <Moon key="m" />], ["system", "System", <Monitor key="c" />]];
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-4">
        <Logo size={72} />
        <p className="text-muted-foreground">Deine stiftoptimierte Notiz-App für die Schule. In ein paar Schritten ist alles eingerichtet – jeden Schritt kannst du später unter <b>Einstellungen</b> wiederholen.</p>
      </div>
      <section aria-labelledby="ob-theme" className="grid gap-2">
        <h2 id="ob-theme" className="font-medium">Design</h2>
        <div className="flex gap-2">
          {themes.map(([v, l, i]) => <Choice key={v} label={l} active={theme === v} onClick={() => setTheme(v)}>{i}{l}</Choice>)}
        </div>
      </section>
      <section aria-labelledby="ob-accent" className="grid gap-2">
        <h2 id="ob-accent" className="font-medium">Akzentfarbe</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-label="Standardfarbe" aria-pressed={!accent} onClick={() => set({ accent: null })}
            className={cn("size-11 rounded-full border-2 bg-foreground", !accent && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")} />
          {ACCENTS.map((c) => (
            <button key={c} type="button" aria-label={`Akzentfarbe ${c}`} aria-pressed={accent === c} onClick={() => set({ accent: c })}
              className={cn("size-11 rounded-full", accent === c && "ring-[3px] ring-primary ring-offset-2 ring-offset-background")} style={{ background: c }} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------- 2 Speicherort ----------

function LocationStep({ onSaved }: { onSaved: (path: string, restart: boolean) => void }) {
  const [loc, setLoc] = useState<{ current: string; suggested: string } | null>(null);
  const [path, setPath] = useState("");
  const [chk, setChk] = useState<DirCheck | null>(null);
  const { busy, msg, run } = useRun();
  useEffect(() => {
    void setupApi.dataLocation().then((l) => { setLoc(l); setPath(l.suggested); });
  }, []);
  useEffect(() => {
    if (!path) return;
    const t = window.setTimeout(() => void setupApi.checkDir(path).then(setChk).catch(() => setChk(null)), 250);
    return () => window.clearTimeout(t);
  }, [path]);
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">Standard ist <b>Dokumente\Noteforge</b>. Die Datenbank wird dorthin kopiert; die Änderung gilt nach einem Neustart.</p>
      {loc && <p className="text-sm text-muted-foreground">Aktuell: <span className="font-mono break-all">{loc.current}</span></p>}
      <div className="grid gap-1.5">
        <Label htmlFor="ob-dir">Ordner</Label>
        <div className="flex gap-2">
          <Input id="ob-dir" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono" />
          <Button variant="outline" size="lg" onClick={() => void setupApi.pickDir(path).then((p) => p && setPath(p))}><FolderOpen /> Wählen …</Button>
        </div>
      </div>
      {chk && (
        <div className="grid gap-1 text-sm" data-testid="dir-check">
          {chk.writable
            ? <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" /> Schreibrechte vorhanden{chk.hasData ? " · hier liegen schon Noteforge-Daten (werden übernommen)" : ""}</p>
            : <p className="flex items-center gap-1.5 text-destructive"><AlertTriangle className="size-4" /> Keine Schreibrechte: {chk.error}</p>}
          {chk.cloud && (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Dieser Ordner liegt in {chk.cloud}. Cloud-Programme können eine geöffnete Datenbank beschädigen – besser einen lokalen Ordner wählen und den Nextcloud-Sync von Noteforge nutzen.</p>
          )}
        </div>
      )}
      <Button className="justify-self-start" size="lg" disabled={busy || !chk?.writable}
        onClick={() => void run(async () => {
          const rs = await setupApi.setDir(path);
          onSaved(path, rs);
          return rs ? "Gespeichert – wird nach dem Neustart am Ende verwendet." : "Dieser Ordner ist bereits aktiv.";
        })}>
        <Check /> Diesen Ordner verwenden
      </Button>
      <Msg m={msg} />
    </div>
  );
}

// ---------- 3 Stift & Hand ----------

function PenStep({ note }: { note: (v: string) => void }) {
  const prefs = usePrefs();
  const s = useSetup();
  const [maxP, setMaxP] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  const curve: [number, string][] = [[0.7, "Weich"], [1, "Normal"], [1.4, "Fest"]];
  const barrel: [BarrelAction, string][] = [["lasso", "Lasso"], ["eraser", "Radierer"], ["radial", "Radialmenü"]];
  useEffect(() => {
    note(`${prefs.leftHanded ? "Linkshänder" : "Rechtshänder"}, Druck ${curve.find(([g]) => g === s.pressureGamma)?.[1] ?? "eigene"}, Stifttaste: ${barrel.find(([b]) => b === s.barrel)?.[1]}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.leftHanded, s.pressureGamma, s.barrel]);
  return (
    <div className="grid gap-5">
      <section className="grid gap-2" aria-labelledby="ob-hand">
        <h2 id="ob-hand" className="font-medium">Schreibhand</h2>
        <div className="flex gap-2">
          <Choice label="Rechtshänder" active={!prefs.leftHanded} onClick={() => prefs.setLeftHanded(false)}><Hand className="-scale-x-100" />Rechtshänder</Choice>
          <Choice label="Linkshänder" active={prefs.leftHanded} onClick={() => prefs.setLeftHanded(true)}><Hand />Linkshänder</Choice>
        </div>
      </section>
      <section className="grid gap-2" aria-labelledby="ob-test">
        <h2 id="ob-test" className="font-medium">Ausprobieren</h2>
        <PenTestField gamma={s.pressureGamma} pmax={s.pressureMax} onPressure={(p) => calibrating && setMaxP((m) => Math.max(m, p))} />
        <div className="flex flex-wrap items-center gap-2">
          {!calibrating ? (
            <Button variant="outline" onClick={() => { setMaxP(0); setCalibrating(true); }}><PenLine /> Druck kalibrieren</Button>
          ) : (
            <>
              <span className="text-sm">Schreib jetzt ein paar Wörter mit <b>festem</b> Druck … stärkster Druck: {Math.round(maxP * 100)} %</span>
              <Button disabled={maxP < 0.2} onClick={() => { s.set({ pressureMax: Math.min(1, Math.max(0.4, maxP)) }); setCalibrating(false); }}>Übernehmen</Button>
            </>
          )}
          {s.pressureMax < 1 && !calibrating && <span className="text-sm text-muted-foreground">Kalibriert: voller Strich ab {Math.round(s.pressureMax * 100)} % Druck</span>}
        </div>
        <div className="flex gap-2" role="group" aria-label="Druckempfindlichkeit">
          {curve.map(([g, l]) => <Choice key={l} label={`Druck ${l}`} active={s.pressureGamma === g} onClick={() => s.set({ pressureGamma: g })}>{l}</Choice>)}
        </div>
      </section>
      <section className="grid gap-2" aria-labelledby="ob-barrel">
        <h2 id="ob-barrel" className="font-medium">Stifttaste</h2>
        <div className="flex gap-2">
          {barrel.map(([b, l]) => <Choice key={b} label={`Stifttaste: ${l}`} active={s.barrel === b} onClick={() => s.set({ barrel: b })}>{l}</Choice>)}
        </div>
      </section>
    </div>
  );
}

/** Kleines Testfeld: zeichnet mit Druckkurve, meldet Rohdruck (für die Kalibrierung). */
function PenTestField({ gamma, pmax, onPressure }: { gamma: number; pmax: number; onPressure: (p: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<number[][][]>([]);
  const cur = useRef<number[][] | null>(null);
  const draw = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = getComputedStyle(c).color;
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])])
      ctx.fill(outlinePath(getStroke(s, { size: 4, thinning: 0.6, smoothing: 0.55, streamline: 0.4, simulatePressure: false })));
  };
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr;
    c.height = r.height * dpr;
  }, []);
  const pt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const raw = e.pointerType === "pen" ? e.pressure : 0.5;
    if (e.pointerType === "pen") onPressure(raw);
    const p = Math.pow(Math.min(1, raw / Math.max(0.05, pmax)), gamma);
    return [e.clientX - r.left, e.clientY - r.top, p];
  };
  return (
    <div className="grid gap-1">
      <canvas ref={ref} aria-label="Stift-Testfeld" data-testid="pen-test-field"
        className="h-40 w-full touch-none rounded-xl border bg-card text-foreground"
        style={{ backgroundImage: "radial-gradient(currentColor 0.6px, transparent 0.6px)", backgroundSize: "19px 19px", backgroundColor: "var(--card)", color: "var(--foreground)" }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = [pt(e)]; draw(); }}
        onPointerMove={(e) => { if (!cur.current) return; for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) cur.current.push(pt(ev as unknown as React.PointerEvent)); draw(); }}
        onPointerUp={() => { if (cur.current) strokes.current.push(cur.current); cur.current = null; draw(); }} />
      <button type="button" className="min-h-11 justify-self-end text-sm text-muted-foreground underline" onClick={() => { strokes.current = []; draw(); }}>Testfeld leeren</button>
    </div>
  );
}

// ---------- 4 Standard-Blatt ----------

function PageStep() {
  const { page, set } = useSetup();
  const bgs: [PageBackground, string, number][] = [["grid", "Kariert 5 mm", 5], ["lines", "Liniert 8 mm", 8], ["dots", "Punktiert 5 mm", 5], ["blank", "Leer", 5]];
  const modes: [PageMode, string, string][] = [["infinite", "Endlos", "Unbegrenzt in alle Richtungen"], ["a4", "DIN A4", "Seiten untereinander, druckfertig"]];
  return (
    <div className="grid gap-5">
      <div className="flex gap-2" role="group" aria-label="Blattart">
        {modes.map(([m, l, d]) => <Choice key={m} label={l} active={page.mode === m} onClick={() => set({ page: { ...page, mode: m } })}><b>{l}</b><span className="text-xs text-muted-foreground">{d}</span></Choice>)}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Hintergrund">
        {bgs.map(([b, l, mm]) => (
          <Choice key={b} label={l} active={page.background === b} onClick={() => set({ page: { ...page, background: b, spacingMm: mm } })}>
            <span aria-hidden className="h-12 w-16 rounded border bg-card" style={bgPreview(b)} />{l}
          </Choice>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Gilt für neue Blätter. Jedes Blatt lässt sich später einzeln umstellen.</p>
    </div>
  );
}

function bgPreview(b: PageBackground): React.CSSProperties {
  const c = "color-mix(in oklch, var(--foreground) 25%, transparent)";
  if (b === "grid") return { backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, backgroundSize: "8px 8px" };
  if (b === "lines") return { backgroundImage: `linear-gradient(${c} 1px, transparent 1px)`, backgroundSize: "100% 12px" };
  if (b === "dots") return { backgroundImage: `radial-gradient(${c} 1px, transparent 1px)`, backgroundSize: "8px 8px" };
  return {};
}

// ---------- 5 WebUntis ----------

function UntisStep({ note }: { note: (v: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SchoolHit[]>([]);
  const [school, setSchool] = useState<SchoolHit | null>(null);
  const [cred, setCred] = useState({ username: "", password: "" });
  const [subjects, setSubjects] = useState<UntisSubject[] | null>(null);
  const [existing, setExisting] = useState<Subject[]>([]);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const search = useRun();
  const conn = useRun();
  const make = useRun();
  const bump = useSyncRev((s) => s.bump);

  useEffect(() => {
    if (school || q.trim().length < 3) { setHits([]); return; }
    const t = window.setTimeout(() => void search.run(async () => {
      const r = await setupApi.searchSchools(q);
      setHits(r);
      return r.length ? "" : "Keine Schule gefunden";
    }), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, school]);

  const matched = useMemo(() => new Map((subjects ?? []).map((u) => [u.id, suggestMatch(u.longName || u.name, existing, (s) => [s.name])])), [subjects, existing]);

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">Optional: Stundenplan, Vertretungen und Ausfälle direkt aus WebUntis. Passwörter liegen nur in der Windows-Anmeldeinformationsverwaltung.</p>
      {!school ? (
        <div className="grid gap-1.5">
          <Label htmlFor="ob-school">Schule suchen</Label>
          <Input id="ob-school" placeholder="Name oder Ort der Schule" value={q} onChange={(e) => setQ(e.target.value)} />
          {search.busy && <p className="text-sm text-muted-foreground">Suche …</p>}
          {search.msg && !search.msg.ok && <Msg m={search.msg} />}
          {search.msg?.ok && search.msg.text && <p className="text-sm text-muted-foreground">{search.msg.text}</p>}
          <ul className="grid gap-1" aria-label="Gefundene Schulen">
            {hits.slice(0, 8).map((h) => (
              <li key={h.login + h.server}>
                <button type="button" onClick={() => setSchool(h)} className="flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left hover:bg-accent">
                  <School className="size-4 shrink-0" /><span className="truncate"><b>{h.name}</b> <span className="text-muted-foreground">{h.address}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          void conn.run(async () => {
            const r = await integrations.untisConnect(school.server, school.login, cred.username, cred.password);
            setCred((c) => ({ ...c, password: "" }));
            bump();
            const [us, ex] = await Promise.all([integrations.untisSubjects(), api.listSubjects()]);
            setSubjects(us);
            setExisting(ex);
            setPick(new Set(us.filter((u) => !suggestMatch(u.longName || u.name, ex, (s) => [s.name])).map((u) => u.id)));
            note(`verbunden (${school.name})`);
            return `Verbindung erfolgreich – ${r.lessons ?? 0} Stunden geladen.`;
          });
        }}>
          <p className="flex items-center gap-2"><School className="size-4" /><b>{school.name}</b>
            <button type="button" className="min-h-11 text-sm underline" onClick={() => { setSchool(null); setSubjects(null); }}>andere Schule</button></p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ob-u-user">Benutzername</Label>
              <Input id="ob-u-user" autoComplete="username" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ob-u-pw">Passwort</Label>
              <Input id="ob-u-pw" type="password" autoComplete="current-password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} /></div>
          </div>
          <Button type="submit" className="justify-self-start" size="lg" disabled={conn.busy || !cred.username}>{conn.busy ? "Teste Verbindung …" : "Verbinden & testen"}</Button>
          <Msg m={conn.msg} />
        </form>
      )}
      {subjects && (
        <section className="grid gap-2" aria-labelledby="ob-subj">
          <h2 id="ob-subj" className="font-medium">Fächer automatisch anlegen</h2>
          <p className="text-sm text-muted-foreground">Ausgewählte Fächer werden angelegt und mit WebUntis verknüpft. Bereits vorhandene werden nur verknüpft.</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {subjects.map((u) => {
              const m = matched.get(u.id);
              return (
                <li key={u.id}>
                  <label className="flex min-h-11 items-center gap-2 rounded-md border px-3">
                    <input type="checkbox" className="size-5" checked={pick.has(u.id) || !!m} disabled={!!m}
                      onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} />
                    <span className="truncate">{u.longName || u.name}</span>
                    {m && <span className="ml-auto text-xs text-muted-foreground">→ {m.name}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <Button className="justify-self-start" size="lg" disabled={make.busy} onClick={() => void make.run(async () => {
            let made = 0, linked = 0;
            for (const u of subjects) {
              const m = matched.get(u.id);
              if (m) { if (m.webuntisSubjectId !== u.id) { await api.updateSubject(m.id, { webuntisSubjectId: u.id }); linked++; } continue; }
              if (!pick.has(u.id)) continue;
              const color = SUBJECT_COLORS[(existing.length + made) % SUBJECT_COLORS.length].value;
              const s = await api.createSubject(u.longName || u.name, color, "book-open");
              await api.updateSubject(s.id, { webuntisSubjectId: u.id });
              made++;
            }
            bump();
            setExisting(await api.listSubjects());
            note(`verbunden, ${made} Fächer angelegt, ${linked} verknüpft`);
            return `${made} Fächer angelegt, ${linked} verknüpft.`;
          })}><GraduationCap /> Bestätigen und anlegen</Button>
          <Msg m={make.msg} />
        </section>
      )}
    </div>
  );
}

// ---------- 6 Moodle ----------

function MoodleStep({ note }: { note: (v: string) => void }) {
  const [m, setM] = useState({ url: "", username: "", password: "" });
  const { busy, msg, run } = useRun();
  const bump = useSyncRev((s) => s.bump);
  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        const r = await integrations.moodleConnect(m.url, m.username, m.password, null);
        setM((x) => ({ ...x, password: "" }));
        bump();
        note("verbunden");
        return `Verbindung erfolgreich – ${r.deadlines ?? 0} Abgaben übernommen.`;
      });
    }}>
      <p className="text-muted-foreground">Optional: Abgaben und Dateien aus Moodle (z. B. Schule BW). Für Schul-Logins mit Token: später unter Einstellungen → Konten.</p>
      <div className="grid gap-1.5"><Label htmlFor="ob-m-url">Moodle-Adresse</Label>
        <Input id="ob-m-url" inputMode="url" placeholder="https://…moodle.schule-bw.de" value={m.url} onChange={(e) => setM({ ...m, url: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="ob-m-user">Benutzername</Label>
          <Input id="ob-m-user" autoComplete="username" value={m.username} onChange={(e) => setM({ ...m, username: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label htmlFor="ob-m-pw">Passwort</Label>
          <Input id="ob-m-pw" type="password" autoComplete="current-password" value={m.password} onChange={(e) => setM({ ...m, password: e.target.value })} /></div>
      </div>
      <Button type="submit" size="lg" className="justify-self-start" disabled={busy || !m.url}>{busy ? "Teste …" : "Verbinden & testen"}</Button>
      <Msg m={msg} />
    </form>
  );
}

// ---------- 7 Nextcloud ----------

function CloudStep({ note }: { note: (v: string) => void }) {
  const [f, setF] = useState({ server: "", username: "", password: "" });
  const { busy, msg, run } = useRun();
  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => {
        await cloud.connect({ ...f, folder: "Noteforge", intervalMin: 15 });
        setF((x) => ({ ...x, password: "" }));
        note("verbunden, alle 15 Minuten");
        return "Testverbindung erfolgreich – Sync läuft alle 15 Minuten.";
      });
    }}>
      <p className="flex items-start gap-2 text-muted-foreground"><Cloud className="mt-0.5 size-5 shrink-0" />Optional: Notizen über deine Nextcloud zwischen Geräten abgleichen. App-Passwort in Nextcloud unter Einstellungen → Sicherheit erzeugen.</p>
      <div className="grid gap-1.5"><Label htmlFor="ob-nc">Server</Label>
        <Input id="ob-nc" inputMode="url" placeholder="https://cloud.example.de" value={f.server} onChange={(e) => setF({ ...f, server: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="ob-nc-user">Benutzername</Label>
          <Input id="ob-nc-user" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label htmlFor="ob-nc-pw">App-Passwort</Label>
          <Input id="ob-nc-pw" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      </div>
      <Button type="submit" size="lg" className="justify-self-start" disabled={busy || !f.server}>{busy ? "Teste …" : "Testverbindung"}</Button>
      <Msg m={msg} />
    </form>
  );
}

// ---------- 8 OneNote-Import ----------

function OneNoteStep({ note }: { note: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("OneNote");
  const { busy, msg, run } = useRun();
  useEffect(() => { void api.listSubjects().then((s) => { setSubjects(s); setTarget(s[0]?.id ?? ""); }); }, []);
  const importFiles = (files: File[]) => void run(async () => {
    let subjectId = target;
    if (!subjectId) subjectId = (await api.createSubject(name || "OneNote", SUBJECT_COLORS[9].value, "book-open")).id;
    const sec = await api.createSection(subjectId, "OneNote-Import", SUBJECT_COLORS[0].value);
    for (const f of files) {
      const bytes = await f.arrayBuffer();
      const imgs = await pdfToImages(bytes.slice(0));
      if (!imgs.length) continue;
      const orientation = orientationOf(imgs[0]);
      const p = await api.createPage(sec.id, null, f.name.replace(/\.pdf$/i, ""));
      await api.updatePage(p.id, { mode: "a4", orientation, background: "blank" });
      const asset = await putAsset(p.id, new Uint8Array(bytes));
      const objs = layoutPdfPages(imgs, { mode: "a4", orientation, z: 0, asset });
      await api.saveElements(p.id, objs.map((o) => objToElement(o, p.id)), []);
    }
    note(`${files.length} Datei(en) importiert`);
    return `${files.length} Datei(en) als Blätter in „OneNote-Import“ angelegt.`;
  });
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">Optional: Exportiere in OneNote ein Notizbuch oder einen Abschnitt über <b>Datei → Exportieren → PDF</b>. Jede PDF wird hier ein Blatt, auf dem du weiterschreiben kannst.</p>
      <div className="grid gap-1.5">
        <Label htmlFor="ob-on-subj">In Fach</Label>
        {subjects.length ? (
          <select id="ob-on-subj" className="h-11 rounded-md border bg-background px-3" value={target} onChange={(e) => setTarget(e.target.value)}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : <Input id="ob-on-subj" value={name} onChange={(e) => setName(e.target.value)} aria-describedby="ob-on-hint" />}
        {!subjects.length && <p id="ob-on-hint" className="text-xs text-muted-foreground">Noch keine Fächer – dieses Fach wird neu angelegt.</p>}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) importFiles(f); }} />
      <Button size="lg" className="justify-self-start" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp /> {busy ? "Importiere …" : "PDF-Export auswählen …"}</Button>
      <Msg m={msg} />
    </div>
  );
}

// ---------- 9 Erinnerungen & Spitz ----------

function ReminderStep({ note }: { note: (v: string) => void }) {
  const s = useSetup();
  const [on, setOn] = useState(true);
  const [perm, setPerm] = useState<boolean | null>(null);
  useEffect(() => { void setupApi.settings().then((x) => setOn(x["app.reminders"] !== "0")); }, []);
  useEffect(() => { note(`${on ? `an, ${s.reminderLead} min vorher` : "aus"}; Spitz ${s.spitz ? "an" : "aus"}`); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [on, s.reminderLead, s.spitz]);
  const toggle = (v: boolean) => { setOn(v); void setupApi.setSetting("app.reminders", v ? "1" : "0"); };
  const leads: [number, string][] = [[0, "Zum Beginn"], [15, "15 Minuten"], [60, "1 Stunde"], [1440, "1 Tag"]];
  return (
    <div className="grid gap-5">
      <section className="grid gap-2" aria-labelledby="ob-rem">
        <h2 id="ob-rem" className="flex items-center gap-2 font-medium"><Bell className="size-4" /> Erinnerungen an Termine</h2>
        <div className="flex gap-2">
          <Choice label="Erinnerungen an" active={on} onClick={() => toggle(true)}>An</Choice>
          <Choice label="Erinnerungen aus" active={!on} onClick={() => toggle(false)}>Aus</Choice>
        </div>
        {on && (
          <>
            <Label htmlFor="ob-lead">Vorlaufzeit für sonstige Termine</Label>
            <select id="ob-lead" className="h-11 rounded-md border bg-background px-3" value={s.reminderLead} onChange={(e) => s.set({ reminderLead: Number(e.target.value) })}>
              {leads.map(([v, l]) => <option key={v} value={v}>{v ? `${l} vorher` : l}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">Klassenarbeiten erinnern 1 Woche, Tests 2 Tage und Abgaben 1 Tag vorher – pro Termin änderbar.</p>
            <Button variant="outline" className="justify-self-start" onClick={() => void requestNotifications().then(setPerm)}>Benachrichtigungen erlauben</Button>
            {perm != null && <p role="status" className={cn("text-sm", perm ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
              {perm ? "Benachrichtigungen sind erlaubt." : "Nicht erlaubt – in Windows unter Einstellungen → System → Benachrichtigungen freigeben."}</p>}
          </>
        )}
      </section>
      <section className="grid gap-2" aria-labelledby="ob-spitz">
        <h2 id="ob-spitz" className="flex items-center gap-2 font-medium"><Sparkles className="size-4" /> Helfer „Spitz“</h2>
        <p className="text-sm text-muted-foreground">Spitz zeigt beim ersten Benutzen eines Werkzeugs einen kurzen Tipp – jederzeit abschaltbar.</p>
        <div className="flex gap-2">
          <Choice label="Spitz an" active={s.spitz} onClick={() => s.set({ spitz: true })}>An</Choice>
          <Choice label="Spitz aus" active={!s.spitz} onClick={() => s.set({ spitz: false })}>Aus</Choice>
        </div>
      </section>
    </div>
  );
}

// ---------- 10 Fertig ----------

function SummaryStep({ summary, restart }: { summary: Summary; restart: boolean }) {
  const { theme } = useTheme();
  const s = useSetup();
  const left = usePrefs((p) => p.leftHanded);
  const bg = { grid: "kariert", lines: "liniert", dots: "punktiert", blank: "leer" }[s.page.background];
  const rows: [string, string][] = [
    ["Design", `${{ light: "Hell", dark: "Dunkel", system: "System" }[theme]}${s.accent ? ", eigene Akzentfarbe" : ""}`],
    ["Speicherort", summary.Speicherort ?? "unverändert"],
    ["Stift & Hand", summary["Stift & Hand"] ?? (left ? "Linkshänder" : "Rechtshänder")],
    ["Standard-Blatt", `${s.page.mode === "a4" ? "DIN A4" : "Endlos"}, ${bg}${s.page.background !== "blank" ? ` ${s.page.spacingMm} mm` : ""}`],
    ["WebUntis", summary.WebUntis ?? "nicht eingerichtet"],
    ["Moodle", summary.Moodle ?? "nicht eingerichtet"],
    ["Nextcloud", summary.Nextcloud ?? "nicht eingerichtet"],
    ["OneNote", summary.OneNote ?? "kein Import"],
    ["Erinnerungen", summary.Erinnerungen ?? `Spitz ${s.spitz ? "an" : "aus"}`],
  ];
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground">Alles bereit. Alles lässt sich später unter <b>Einstellungen</b> ändern – dort kannst du diesen Assistenten auch erneut starten.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4" data-testid="ob-summary">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="font-medium">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>)}
      </dl>
      {restart && <p className="text-sm text-amber-700 dark:text-amber-400">Noteforge startet einmal neu, um den neuen Speicherort zu verwenden.</p>}
    </div>
  );
}
