import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { currentLesson, daySlots, integrations, syncNow, useSyncRev, type Lesson } from "@/lib/integrations";
import type { Subject } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { useNav } from "@/store/nav";
import { DAY, fmtTime, startOfDay } from "@/features/calendar/dates";

/** Öffnet das Fach einer Stunde beim zuletzt bearbeiteten Blatt. */
export async function openLessonSubject(subjectId: string, go: ReturnType<typeof useNav.getState>["go"]) {
  const pages = await api.listPages(subjectId).catch(() => []);
  const last = [...pages].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  go({ view: "subject", subjectId, pageId: last?.id ?? null });
}

/** Startseite: heutiger Stundenplan + „Aktuelle Stunde öffnen“. */
export function TodayTimetable({ subjects }: { subjects: Subject[]; onSetup?: () => void }) {
  const go = useNav((s) => s.go);
  const rev = useSyncRev((s) => s.rev);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    void syncNow(false).catch(() => {});
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const day = startOfDay(new Date(now)).getTime();
  const { data } = useAsync(async () => {
    const st = await integrations.status();
    return { connected: !!st.untis, lessons: st.untis ? await integrations.listLessons(day, day + DAY) : [] };
  }, [day, rev, subjects]);
  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  if (!data) return null;
  if (!data.connected) return null;
  const cur = currentLesson(data.lessons, now);
  const curSubject = cur?.lesson.subjectId ? subj.get(cur.lesson.subjectId) : undefined;

  return (
    <section aria-labelledby="today-h" className="mb-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="today-h" className="mr-auto text-lg font-medium">Heute</h2>
        {cur && (
          <Button size="lg" disabled={!curSubject} data-testid="open-current-lesson"
            title={curSubject ? undefined : "Dieses WebUntis-Fach ist noch keinem Fach zugeordnet"}
            style={curSubject ? { background: curSubject.color } : undefined}
            className={curSubject ? "text-white hover:opacity-90" : ""}
            onClick={() => curSubject && void openLessonSubject(curSubject.id, go)}>
            <BookOpen /> {cur.running ? "Aktuelle Stunde öffnen" : "Nächste Stunde öffnen"}: {curSubject?.name ?? (cur.lesson.subjectLong || cur.lesson.subjectName)}
          </Button>
        )}
      </div>
      {data.lessons.length === 0 ? (
        <p data-glass="panel" className="rounded-xl border border-dashed p-4 text-muted-foreground">Heute kein Unterricht laut WebUntis.</p>
      ) : (
        <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Stundenplan heute">
          {daySlots(data.lessons).map((x) => x.kind === "free"
            ? <FreeCard key={`free:${x.start}`} start={x.start} end={x.end} reason={x.reason} now={now} />
            : <LessonCard key={`${x.lesson.id}:${x.lesson.start}`} l={x.lesson} s={x.lesson.subjectId ? subj.get(x.lesson.subjectId) : undefined}
              now={now} onOpen={(id) => void openLessonSubject(id, go)} />)}
        </ol>
      )}
    </section>
  );
}

function LessonCard({ l, s, now, onOpen }: { l: Lesson; s?: Subject; now: number; onOpen: (subjectId: string) => void }) {
  const running = l.start <= now && now < l.end;
  const cancelled = l.state === "cancelled";
  return (
    <li className="shrink-0">
      <button type="button" disabled={!s} onClick={() => s && onOpen(s.id)}
        aria-label={`${fmtTime(l.start)} ${l.subjectLong || l.subjectName}${cancelled ? " (entfällt)" : ""}`}
        data-glass="tile"
        className={`flex min-h-16 w-36 flex-col items-start rounded-lg border-l-4 bg-card p-2 text-left text-sm shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent ${running ? "ring-2 ring-primary" : ""} ${l.end < now ? "opacity-60" : ""}`}
        style={{ borderLeftColor: s?.color ?? "var(--border)" }}>
        <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(l.start)} – {fmtTime(l.end)}</span>
        <span className={`w-full truncate font-medium ${cancelled ? "line-through" : ""}`}>{s?.name ?? (l.subjectLong || l.subjectName || "Stunde")}</span>
        <span className={`w-full truncate text-xs ${cancelled || l.state === "irregular" ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {cancelled ? "entfällt" : l.state === "irregular" ? `Vertretung${l.info ? `: ${l.info}` : ""}` : [l.rooms, l.teachers].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  );
}

/** Freistunde: eigene Farbe/Streifen; „Entfall“ vs. reguläre Lücke. */
export function FreeCard({ start, end, reason, now }: { start: number; end: number; reason: "gap" | "cancelled"; now: number }) {
  const running = start <= now && now < end;
  return (
    <li className="shrink-0" data-testid="free-period" data-reason={reason}>
      <div data-reason={reason} aria-label={`Freistunde ${fmtTime(start)} bis ${fmtTime(end)}${reason === "cancelled" ? " (Entfall)" : ""}`}
        className={`nf-free flex min-h-16 w-36 flex-col items-start rounded-lg border-l-4 border-dashed p-2 text-sm ${running ? "ring-2 ring-primary" : ""} ${end < now ? "opacity-60" : ""}`}>
        <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(start)} – {fmtTime(end)}</span>
        <span className="font-medium">Freistunde</span>
        <span className="text-xs text-muted-foreground">{reason === "cancelled" ? "Stunde entfällt" : "Lücke im Plan"}</span>
      </div>
    </li>
  );
}
