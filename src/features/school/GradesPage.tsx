import { useMemo, useState } from "react";
import { ArrowLeft, Calculator, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { api } from "@/lib/api";
import {
  DEFAULT_WRITTEN_PCT, SCALE, fmtGrade, gradeLabel, gradeTone, groupBySubject, neededGrade, overallAverage, parseGrade,
  school, subjectAverage, type Grade, type GradeConfig, type GradeKind, type GradeScale,
} from "@/lib/school";
import { useCloudRev } from "@/lib/sync";
import type { Subject } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";
import { useNav } from "@/store/nav";
import { fmtDate, fromInputs, toDateInput } from "@/features/calendar/dates";
import { selectCls, toneCls } from "./common";

export const KIND_TEXT: Record<GradeKind, string> = { written: "schriftlich", oral: "mündlich" };

export function useGrades() {
  const cloud = useCloudRev((s) => s.rev);
  return useAsync(async () => {
    const [grades, cfg] = await Promise.all([school.listGrades(), school.gradeConfig()]);
    return { grades, cfg };
  }, [cloud]);
}

/** Notenrechner: Noten je Fach, Gewichtung schriftlich/mündlich, Schnitte und „Was brauche ich?“. */
export function GradesPage({ subjectId }: { subjectId?: string }) {
  const go = useNav((s) => s.go);
  const { data: subjects } = useAsync(() => api.listSubjects(), []);
  const { data, reload, error } = useGrades();
  const [msg, setMsg] = useState<string | null>(null);
  const cfg = data?.cfg ?? { scale: "grades" as GradeScale, writtenPct: {} };
  const by = useMemo(() => groupBySubject(data?.grades ?? []), [data]);
  const overall = data ? overallAverage(data.grades, cfg) : null;

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); setMsg(null); } catch (e) { setMsg(String(e)); }
    await reload();
  };

  // Fächer mit Noten zuerst, sonst Reihenfolge der Startseite; gewähltes Fach ganz oben
  const list = [...(subjects ?? [])].sort((a, b) =>
    Number(b.id === subjectId) - Number(a.id === subjectId) || Number(by.has(b.id)) - Number(by.has(a.id)) || a.order - b.order);

  return (
    <div className="flex h-full flex-col">
      <header data-glass="bar" className="flex items-center gap-2 border-b px-2 py-1">
        <Button variant="ghost" size="icon" aria-label="Zurück" onClick={() => go({ view: "home" })}><ArrowLeft /></Button>
        <h1 className="mr-auto ml-1 text-lg font-semibold">Noten</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only">Notensystem</span>
          <select className={selectCls} value={cfg.scale} aria-label="Notensystem"
            onChange={(e) => {
              const s = e.target.value as GradeScale;
              if (data?.grades.length && !window.confirm("Vorhandene Noten werden umgerechnet (Punkte = 17 − 3 × Note). Fortfahren?")) return;
              void run(() => school.setGradeScale(s));
            }}>
            {(Object.keys(SCALE) as GradeScale[]).map((s) => <option key={s} value={s}>{SCALE[s].label}</option>)}
          </select>
        </label>
        <Button variant="ghost" onClick={() => go({ view: "homework" })}>Hausaufgaben</Button>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-auto p-4">
        <div className="mb-4 flex flex-wrap items-baseline gap-3 rounded-xl border p-4">
          <span className="text-muted-foreground">Gesamtschnitt</span>
          <span data-testid="overall" className={cn("text-3xl font-bold tabular-nums", toneCls[gradeTone(overall, cfg.scale) ?? "mid"], overall == null && "text-muted-foreground")}>
            {fmtGrade(overall, cfg.scale)}
          </span>
          <span className="text-sm text-muted-foreground">
            {by.size} {by.size === 1 ? "Fach" : "Fächer"} mit Noten · jedes Fach zählt gleich
          </span>
        </div>
        {(error || msg) && <p role="alert" className="mb-3 text-sm text-destructive">{error ?? msg}</p>}
        {subjects?.length === 0 && <p className="text-muted-foreground">Lege zuerst auf der Startseite Fächer an.</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((s) => (
            <SubjectGrades key={s.id} subject={s} grades={by.get(s.id) ?? []} cfg={cfg} run={run} />
          ))}
        </div>
      </main>
    </div>
  );
}

function SubjectGrades({ subject, grades, cfg, run }: {
  subject: Subject; grades: Grade[]; cfg: GradeConfig; run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const pct = cfg.writtenPct[subject.id] ?? DEFAULT_WRITTEN_PCT;
  const [pctDraft, setPctDraft] = useState<number | null>(null);
  const avg = subjectAverage(grades, pctDraft ?? pct);
  const [adding, setAdding] = useState(false);
  const [calc, setCalc] = useState(false);
  const scale = cfg.scale;

  return (
    <section className="rounded-xl border" aria-labelledby={`g-${subject.id}`} style={{ borderTop: `6px solid ${subject.color}` }} data-testid="subject-grades">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <h2 id={`g-${subject.id}`} className="mr-auto text-lg font-medium">{subject.name}</h2>
        <span className={cn("text-2xl font-bold tabular-nums", avg.total == null ? "text-muted-foreground" : toneCls[gradeTone(avg.total, scale)!])} aria-label="Fachschnitt">
          {fmtGrade(avg.total, scale)}
        </span>
      </div>
      <div className="grid gap-1 px-3 text-sm text-muted-foreground">
        <div className="flex gap-4">
          <span>schriftlich <b className="text-foreground tabular-nums">{fmtGrade(avg.written, scale)}</b></span>
          <span>mündlich <b className="text-foreground tabular-nums">{fmtGrade(avg.oral, scale)}</b></span>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-36 shrink-0">Gewichtung {pctDraft ?? pct} : {100 - (pctDraft ?? pct)}</span>
          <input type="range" min={0} max={100} step={5} value={pctDraft ?? pct} aria-label={`Anteil schriftlich in ${subject.name}`}
            className="h-11 flex-1" onChange={(e) => setPctDraft(Number(e.target.value))}
            onPointerUp={() => pctDraft != null && void run(() => school.setSubjectWeight(subject.id, pctDraft)).then(() => setPctDraft(null))}
            onKeyUp={() => pctDraft != null && void run(() => school.setSubjectWeight(subject.id, pctDraft)).then(() => setPctDraft(null))} />
        </label>
      </div>

      {grades.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 p-3" aria-label={`Noten ${subject.name}`}>
          {grades.map((g) => (
            <li key={g.id} className="group flex items-center rounded-full border bg-muted/40 pl-3 text-sm" title={`${g.title || KIND_TEXT[g.kind]} · ${fmtDate(g.date, false)} · Gewicht ${g.weight}`}>
              <span className={cn("font-semibold tabular-nums", toneCls[gradeTone(g.value, scale)!])}>{gradeLabel(g.value, scale)}</span>
              <span className="ml-1.5 text-muted-foreground">{g.kind === "written" ? "S" : "M"}{g.weight !== 1 ? ` ×${g.weight}` : ""}{g.title ? ` · ${g.title}` : ""}</span>
              <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={`Note ${gradeLabel(g.value, scale)} löschen`}
                onClick={() => void run(() => school.deleteGrade(g.id))}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 border-t p-2">
        <Button variant={adding ? "secondary" : "ghost"} onClick={() => setAdding(!adding)}><Plus /> Note eintragen</Button>
        <Button variant={calc ? "secondary" : "ghost"} onClick={() => setCalc(!calc)}><Calculator /> Was brauche ich?</Button>
      </div>
      {adding && <AddGrade subject={subject} scale={scale} onAdd={(g) => run(() => school.saveGrade(g))} />}
      {calc && <NeededCalc grades={grades} pct={pct} scale={scale} />}
    </section>
  );
}

function AddGrade({ subject, scale, onAdd }: { subject: Subject; scale: GradeScale; onAdd: (g: Grade) => Promise<void> }) {
  const [f, setF] = useState({ value: "", kind: "written" as GradeKind, weight: "1", title: "", date: toDateInput(Date.now()) });
  const value = parseGrade(f.value, scale);
  const weight = Number(f.weight.replace(",", "."));
  const ok = value != null && weight > 0 && weight <= 10;
  const id = `ag-${subject.id}`;
  return (
    <form className="grid grid-cols-2 gap-2 border-t p-3 sm:grid-cols-[6rem_9rem_5rem_1fr]" aria-label={`Note eintragen ${subject.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        void onAdd({ id: "", subjectId: subject.id, kind: f.kind, title: f.title, value: value!, weight, date: fromInputs(f.date, "12:00") })
          .then(() => setF((x) => ({ ...x, value: "", title: "" })));
      }}>
      <div className="grid gap-1"><Label htmlFor={`${id}-v`}>{SCALE[scale].unit}</Label>
        <Input id={`${id}-v`} inputMode="decimal" placeholder={scale === "points" ? "0–15" : "z. B. 2-"} aria-invalid={!!f.value && value == null}
          value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
      <div className="grid gap-1"><Label htmlFor={`${id}-k`}>Art</Label>
        <select id={`${id}-k`} className={selectCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as GradeKind })}>
          <option value="written">schriftlich</option><option value="oral">mündlich</option>
        </select></div>
      <div className="grid gap-1"><Label htmlFor={`${id}-w`}>Gewicht</Label>
        <Input id={`${id}-w`} inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></div>
      <div className="grid gap-1"><Label htmlFor={`${id}-t`}>Bezeichnung</Label>
        <Input id={`${id}-t`} placeholder="z. B. 1. Klassenarbeit" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="grid gap-1"><Label htmlFor={`${id}-d`}>Datum</Label>
        <Input id={`${id}-d`} type="date" className="h-11" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
      <Button type="submit" className="self-end" disabled={!ok}>Eintragen</Button>
    </form>
  );
}

function NeededCalc({ grades, pct, scale }: { grades: Grade[]; pct: number; scale: GradeScale }) {
  const [target, setTarget] = useState(scale === "points" ? "10" : "2,5");
  const [kind, setKind] = useState<GradeKind>("written");
  const [weight, setWeight] = useState("1");
  const t = parseGrade(target, scale);
  const w = Number(weight.replace(",", "."));
  const r = t != null && w > 0 ? neededGrade(grades, pct, scale, t, kind, w) : null;
  const unit = scale === "points" ? "Punkte" : "eine";
  return (
    <div className="grid gap-2 border-t p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><Label htmlFor="nc-t">Ziel-Schnitt</Label>
          <Input id="nc-t" className="w-24" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div className="grid gap-1"><Label htmlFor="nc-k">Nächste Leistung</Label>
          <select id="nc-k" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as GradeKind)}>
            <option value="written">schriftlich</option><option value="oral">mündlich</option>
          </select></div>
        <div className="grid gap-1"><Label htmlFor="nc-w">Gewicht</Label>
          <Input id="nc-w" className="w-20" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
      </div>
      <p role="status" className="text-sm" data-testid="needed">
        {r == null ? "Bitte gültigen Ziel-Schnitt eingeben."
          : r.kind === "safe" ? "Das Ziel ist mit jeder Note sicher erreicht."
          : r.kind === "impossible" ? `Mit einer Leistung nicht mehr erreichbar – bestenfalls ${fmtGrade(r.best, scale)}.`
          : scale === "points" ? `Du brauchst mindestens ${r.value} ${unit}.`
          : `Du brauchst ${unit} ${fmtGrade(r.value, scale)} oder besser (${gradeLabel(r.value, scale)}).`}
      </p>
    </div>
  );
}
