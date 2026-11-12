import { useEffect, useMemo, useState } from "react";
import { BookCheck, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtGrade, gradeTone, groupBySubject, overallAverage, school, subjectAverage, DEFAULT_WRITTEN_PCT } from "@/lib/school";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNav } from "@/store/nav";
import { HomeworkRow, useHomework } from "@/features/school/HomeworkPage";
import { useGrades } from "@/features/school/GradesPage";
import { toneCls } from "@/features/school/common";

/** Startseite: offene Hausaufgaben (zum Abhaken) und Notenschnitt. */
export function SchoolWidgets({ subjects }: { subjects: Subject[] }) {
  const go = useNav((s) => s.go);
  const hw = useHomework();
  const gr = useGrades();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const open = (hw.data ?? []).filter((h) => h.doneAt == null);
  const shown = open.slice(0, 5);

  const cfg = gr.data?.cfg;
  const overall = gr.data && cfg ? overallAverage(gr.data.grades, cfg) : null;
  const per = gr.data && cfg
    ? [...groupBySubject(gr.data.grades)].map(([id, gs]) => ({ s: subj.get(id), avg: subjectAverage(gs, cfg.writtenPct[id] ?? DEFAULT_WRITTEN_PCT).total }))
        .filter((x) => x.s && x.avg != null)
    : [];
  const scale = cfg?.scale ?? "grades";

  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section aria-labelledby="hw-h" className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="hw-h" className="mr-auto text-lg font-medium">Hausaufgaben {open.length > 0 && <span className="text-muted-foreground font-normal">· {open.length} offen</span>}</h2>
          <Button variant="ghost" onClick={() => go({ view: "homework" })}><BookCheck /> Alle</Button>
        </div>
        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-muted-foreground">Keine offenen Hausaufgaben</p>
        ) : (
          <ul className="divide-y rounded-xl border" aria-label="Offene Hausaufgaben">
            {shown.map((h) => (
              <HomeworkRow key={h.id} h={h} compact now={now} subject={h.subjectId ? subj.get(h.subjectId) : undefined}
                onEdit={() => go({ view: "homework" })}
                onToggle={(d) => void school.setHomeworkDone(h.id, d).then(hw.reload, console.error)} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="gr-h">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="gr-h" className="mr-auto text-lg font-medium">Noten</h2>
          <Button variant="ghost" onClick={() => go({ view: "grades" })}><GraduationCap /> Rechner</Button>
        </div>
        <button type="button" onClick={() => go({ view: "grades" })}
          className="w-full rounded-xl border p-4 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Schnitt</span>
            <span data-testid="home-overall" className={cn("text-3xl font-bold tabular-nums", overall == null ? "text-muted-foreground" : toneCls[gradeTone(overall, scale)!])}>
              {fmtGrade(overall, scale)}
            </span>
          </div>
          {per.length === 0 ? null : (
            <ul className="mt-2 grid gap-0.5 text-sm">
              {per.slice(0, 6).map(({ s, avg }) => (
                <li key={s!.id} className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: s!.color }} />
                  <span className="mr-auto truncate">{s!.name}</span>
                  <span className={cn("tabular-nums", toneCls[gradeTone(avg, scale)!])}>{fmtGrade(avg, scale)}</span>
                </li>
              ))}
            </ul>
          )}
        </button>
      </section>
    </div>
  );
}
