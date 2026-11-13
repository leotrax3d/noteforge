import { useMemo } from "react";
import { AlertTriangle, CalendarDays, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Subject } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { useNav } from "@/store/nav";
import { useSyncRev } from "@/lib/integrations";
import { DAY, KIND_LABEL, countdown, fmtDate, fmtTime, isAllDay } from "@/features/calendar/dates";
import { examsTomorrow } from "@/lib/timetable";

const HORIZON = 120 * DAY;

/**
 * Startseiten-Widget „Arbeiten & Tests“ mit Countdown: von WebUntis angekündigte und im Kalender selbst
 * als Arbeit/Test markierte Termine in einer Liste; Hinweis, wenn morgen eine ansteht.
 */
export function UpcomingExams({ subjects, now }: { subjects: Subject[]; now: number }) {
  const go = useNav((s) => s.go);
  const dayKey = Math.floor(now / DAY);
  const rev = useSyncRev((s) => s.rev);
  const { data } = useAsync(() => api.listEvents(now - 3 * 3600_000, now + HORIZON), [dayKey, rev]);
  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const all = (data ?? []).filter((e) => (e.type === "exam" || e.type === "test") && (e.end ?? e.start + 2 * 3600_000) > now);
  const list = all.slice(0, 5);
  const tomorrow = examsTomorrow(all, now);

  return (
    <section aria-labelledby="upcoming-h" className="mb-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="upcoming-h" className="mr-auto text-lg font-medium">Arbeiten & Tests</h2>
        <Button variant="ghost" onClick={() => go({ view: "calendar" })}><CalendarDays /> Kalender</Button>
      </div>
      {tomorrow.length > 0 && (
        <div role="alert" data-testid="exam-tomorrow" className="mb-3 flex min-h-11 items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-destructive">
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          <span className="font-medium">
            Morgen: {tomorrow.map((e) => `${KIND_LABEL[e.type]} ${e.subjectId ? subj.get(e.subjectId)?.name ?? "" : ""}${isAllDay(e) ? "" : ` (${fmtTime(e.start)})`}`.replace(/\s+/g, " ").trim()).join(", ")}
          </span>
        </div>
      )}
      {list.length === 0 ? (
        <p data-glass="panel" className="rounded-xl border border-dashed p-4 text-muted-foreground">
          Keine Arbeiten oder Tests angekündigt
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {list.map((e) => {
            const s = e.subjectId ? subj.get(e.subjectId) : undefined;
            const cd = countdown(e.start, now);
            const urgent = cd.days <= 3;
            return (
              <li key={e.id}>
                <button type="button" data-glass="tile" onClick={() => go({ view: "calendar", date: e.start })}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  style={{ borderLeft: `6px solid ${s?.color ?? "var(--border)"}` }}>
                  <div className={`flex w-14 shrink-0 flex-col items-center rounded-lg py-1 ${urgent ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                    <span className="text-2xl leading-none font-bold tabular-nums">{Math.max(0, cd.days)}</span>
                    <span className="text-xs">{cd.days === 1 ? "Tag" : "Tage"}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{e.title}</div>
                    <div className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      {KIND_LABEL[e.type]}{s ? ` · ${s.name}` : ""}
                      <SourceBadge source={e.source} />
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

/** WebUntis-Termin vs. selbst im Kalender markierter Termin. */
export function SourceBadge({ source }: { source: string }) {
  return source === "webuntis"
    ? <span className="rounded bg-sky-100 px-1.5 text-xs font-medium text-sky-900 dark:bg-sky-900/50 dark:text-sky-100" title="Von WebUntis angekündigt">WebUntis</span>
    : <span className="rounded bg-muted px-1.5 text-xs" title="Selbst im Kalender eingetragen">Eigener Termin</span>;
}
