import { useEffect, useMemo, useState } from "react";
import { CalendarDays, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Subject } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { useNav } from "@/store/nav";
import { DAY, KIND_LABEL, countdown, fmtDate, fmtTime, isAllDay } from "@/features/calendar/dates";

const HORIZON = 120 * DAY;

/** Startseiten-Widget „Nächste Klassenarbeiten“ mit Countdown. */
export function UpcomingExams({ subjects }: { subjects: Subject[] }) {
  const go = useNav((s) => s.go);
  const [now, setNow] = useState(() => Date.now());
  // Minütlich aktualisieren, damit „heute, in 2 Std.“ stimmt.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const dayKey = Math.floor(now / DAY);
  const { data } = useAsync(() => api.listEvents(Date.now() - 3 * 3600_000, Date.now() + HORIZON), [dayKey]);
  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const list = (data ?? [])
    .filter((e) => (e.type === "exam" || e.type === "test") && (e.end ?? e.start + 2 * 3600_000) > now)
    .slice(0, 5);

  return (
    <section aria-labelledby="upcoming-h" className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="upcoming-h" className="mr-auto text-lg font-medium">Nächste Klassenarbeiten</h2>
        <Button variant="ghost" onClick={() => go({ view: "calendar" })}><CalendarDays /> Kalender</Button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-muted-foreground">
          Keine Klassenarbeiten oder Tests in den nächsten Wochen. Trage sie im Kalender ein.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {list.map((e) => {
            const s = e.subjectId ? subj.get(e.subjectId) : undefined;
            const cd = countdown(e.start, now);
            const urgent = cd.days <= 3;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => go({ view: "calendar", date: e.start })}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  style={{ borderLeft: `6px solid ${s?.color ?? "var(--border)"}` }}>
                  <div className={`flex w-14 shrink-0 flex-col items-center rounded-lg py-1 ${urgent ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                    <span className="text-2xl leading-none font-bold tabular-nums">{Math.max(0, cd.days)}</span>
                    <span className="text-xs">{cd.days === 1 ? "Tag" : "Tage"}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{e.title}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {KIND_LABEL[e.type]}{s ? ` · ${s.name}` : ""}
                    </div>
                    <div className="text-sm">
                      <span className={urgent ? "font-medium text-destructive" : ""}>{cd.label}</span>
                      <span className="text-muted-foreground"> · {fmtDate(e.start)}{isAllDay(e) ? "" : `, ${fmtTime(e.start)}`}</span>
                    </div>
                  </div>
                  <GraduationCap className="ml-auto size-5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
