import { useMemo, useState } from "react";
import { BookOpen, CalendarDays, ChevronDown, Coffee, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScheduleDots, dotsLabel } from "@/components/school/ScheduleDots";
import { api } from "@/lib/api";
import { currentLesson, daySlots, type Lesson } from "@/lib/integrations";
import { BREAK_LABEL, currentBreak, dotCounts } from "@/lib/timetable";
import type { Subject } from "@/lib/types";
import { useNav } from "@/store/nav";
import { DAY, fmtTime, startOfDay } from "@/features/calendar/dates";

/** Öffnet das Fach einer Stunde beim zuletzt bearbeiteten Blatt. */
export async function openLessonSubject(subjectId: string, go: ReturnType<typeof useNav.getState>["go"]) {
  const pages = await api.listPages(subjectId).catch(() => []);
  const last = [...pages].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  go({ view: "subject", subjectId, pageId: last?.id ?? null });
}

type View = "today" | "tomorrow";
const VIEW_LABEL: Record<View, string> = { today: "Heute", tomorrow: "Morgen" };

/** Startseite: Stundenplan (Heute/Morgen) mit Ansichtsmenü + Dots, Pausen-Banner, „Aktuelle Stunde öffnen“. */
export function TodayTimetable({ subjects, lessons, now }: { subjects: Subject[]; lessons: Lesson[]; now: number }) {
  const go = useNav((s) => s.go);
  const [view, setView] = useState<View>("today");
  const day = startOfDay(new Date(now)).getTime() + (view === "tomorrow" ? DAY : 0);
  const dayLessons = useMemo(() => lessons.filter((l) => l.start >= day && l.start < day + DAY), [lessons, day]);
  const subj = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const counts = useMemo(() => dotCounts(lessons, now), [lessons, now]);
  const cur = view === "today" ? currentLesson(dayLessons, now) : null;
  const pause = view === "today" ? currentBreak(dayLessons, now) : null;
  const curSubject = cur?.lesson.subjectId ? subj.get(cur.lesson.subjectId) : undefined;
  const nextSubject = pause?.next.subjectId ? subj.get(pause.next.subjectId) : undefined;

  return (
    <section aria-labelledby="today-h" className="mb-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="today-h" className="sr-only">Stundenplan {VIEW_LABEL[view]}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="-ml-2 h-11 text-lg font-medium" data-testid="timetable-menu"
              aria-label={`Stundenplan-Ansicht: ${VIEW_LABEL[view]}${dotsLabel(counts)}`}>
              {VIEW_LABEL[view]} <ChevronDown className="size-4" />
              <ScheduleDots counts={counts} className="ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setView("today")}>Heute</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setView("tomorrow")}>Morgen</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => go({ view: "calendar" })}><CalendarDays /> Woche im Kalender</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="mr-auto" />
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
      {pause && (
        <div role="status" data-testid="break-banner" data-kind={pause.kind} data-glass="panel"
          className="mb-3 flex min-h-11 items-center gap-3 rounded-xl border bg-muted/50 px-4 py-2">
          {pause.kind === "lunch" ? <Utensils className="size-5 shrink-0" aria-hidden /> : <Coffee className="size-5 shrink-0" aria-hidden />}
          <span className="font-medium">{BREAK_LABEL[pause.kind]}{pause.kind === "big" || pause.kind === "lunch" ? ` · ${pause.minutes} min` : ""}</span>
          <span className="text-muted-foreground">
            noch {Math.max(1, Math.ceil((pause.end - now) / 60_000))} min · danach {nextSubject?.name ?? (pause.next.subjectLong || pause.next.subjectName)} um {fmtTime(pause.end)}
          </span>
        </div>
      )}
      {dayLessons.length === 0 ? (
        <p data-glass="panel" className="rounded-xl border border-dashed p-4 text-muted-foreground">{VIEW_LABEL[view]} kein Unterricht laut WebUntis.</p>
      ) : (
        <ol className="flex gap-2 overflow-x-auto pb-1" aria-label={`Stundenplan ${VIEW_LABEL[view].toLowerCase()}`}>
          {daySlots(dayLessons).map((x) => x.kind === "free"
            ? <FreeCard key={`free:${x.start}`} start={x.start} end={x.end} reason={x.reason} now={now} />
            : x.kind === "lunch"
              ? <LunchCard key={`lunch:${x.start}`} start={x.start} end={x.end} now={now} />
              : <LessonCard key={`${x.lesson.id}:${x.lesson.start}`} l={x.lesson} s={x.lesson.subjectId ? subj.get(x.lesson.subjectId) : undefined}
                now={now} onOpen={(id) => void openLessonSubject(id, go)} />)}
        </ol>
      )}
    </section>
  );
}

function LessonCard({ l, s, now, onOpen }: { l: Lesson; s?: Subject; now: number; onOpen: (subjectId: string) => void }) {
  const running = l.start <= now && now < l.end && l.state !== "cancelled";
  const cancelled = l.state === "cancelled";
  return (
    <li className="shrink-0">
      <button type="button" disabled={!s} onClick={() => s && onOpen(s.id)}
        aria-label={`${fmtTime(l.start)} ${l.subjectLong || l.subjectName}${cancelled ? " (entfällt)" : l.state === "irregular" ? " (Vertretung)" : ""}${running ? " (läuft gerade)" : ""}`}
        data-glass="tile" data-state={l.state}
        className={`flex min-h-16 w-36 flex-col items-start rounded-lg border-l-4 bg-card p-2 text-left text-sm shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:bg-accent ${running ? "ring-2 ring-primary" : ""} ${l.end < now ? "opacity-60" : ""}`}
        style={{ borderLeftColor: s?.color ?? "var(--border)" }}>
        <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(l.start)} – {fmtTime(l.end)}</span>
        <span className={`w-full truncate font-medium ${cancelled ? "line-through" : ""}`}>{s?.name ?? (l.subjectLong || l.subjectName || "Stunde")}</span>
        <span className={`w-full truncate text-xs ${cancelled ? "font-medium text-destructive" : l.state === "irregular" ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
          {cancelled ? "entfällt" : l.state === "irregular" ? `Vertretung${l.info ? `: ${l.info}` : ""}` : [l.rooms, l.teachers].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  );
}

function LunchCard({ start, end, now }: { start: number; end: number; now: number }) {
  return (
    <li className="shrink-0" data-testid="lunch">
      <div aria-label={`Mittagspause ${fmtTime(start)} bis ${fmtTime(end)}`}
        className={`flex min-h-16 w-28 flex-col items-start rounded-lg border border-dashed p-2 text-sm text-muted-foreground ${start <= now && now < end ? "ring-2 ring-primary" : ""} ${end < now ? "opacity-60" : ""}`}>
        <span className="text-xs tabular-nums">{fmtTime(start)} – {fmtTime(end)}</span>
        <span className="flex items-center gap-1 font-medium text-foreground"><Utensils className="size-3.5" aria-hidden /> Mittag</span>
      </div>
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
