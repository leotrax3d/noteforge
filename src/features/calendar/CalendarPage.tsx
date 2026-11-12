import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { api } from "@/lib/api";
import type { CalendarEvent, Subject } from "@/lib/types";
import { mutate, useAsync } from "@/lib/use-async";
import { useNav } from "@/store/nav";
import { daySlots, integrations, useSyncRev, type Lesson } from "@/lib/integrations";
import { openLessonSubject } from "@/features/home/TodayTimetable";
import {
  MONTHS, WEEKDAYS, addDays, eventsOn, fmtDate, fmtTime, isAllDay, isoWeek, monthGrid, sameDay, startOfDay, startOfWeek,
} from "./dates";
import { EventChip } from "./EventChip";
import { EventDialog, newEvent } from "./EventDialog";

type Mode = "month" | "week";
const HOUR_PX = 48;
const FIRST_HOUR = 7, LAST_HOUR = 20;

export function CalendarPage({ date: initial, mode: initialMode }: { date?: number; mode?: Mode }) {
  const go = useNav((s) => s.go);
  const [mode, setMode] = useState<Mode>(initialMode ?? "month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date(initial ?? Date.now())));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const today = startOfDay(new Date());

  const days = useMemo(
    () => (mode === "month" ? monthGrid(cursor.getFullYear(), cursor.getMonth()) : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))),
    [mode, cursor],
  );
  const from = days[0].getTime(), to = addDays(days[days.length - 1], 1).getTime();
  const rev = useSyncRev((s) => s.rev);
  const { data: events, reload } = useAsync(() => api.listEvents(from, to), [from, to, rev]);
  const { data: lessons } = useAsync(() => (mode === "week" ? integrations.listLessons(from, to) : Promise.resolve([])), [mode, from, to, rev]);
  const { data: subjects } = useAsync(() => api.listSubjects(), []);
  const subj = useMemo(() => new Map((subjects ?? []).map((s) => [s.id, s] as [string, Subject])), [subjects]);

  const step = (n: number) => setCursor((c) => (mode === "month" ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, 7 * n)));
  const title = mode === "month"
    ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : `KW ${isoWeek(days[0])} · ${fmtDate(days[0].getTime(), false)} – ${fmtDate(days[6].getTime(), false)} ${days[6].getFullYear()}`;

  const create = (day: Date, hour?: number) => {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 0);
    setEditing(newEvent(d.getTime()));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon" aria-label="Zurück zur Startseite" onClick={() => go({ view: "home" })}><ArrowLeft /></Button>
        <h1 className="mr-2 text-xl font-semibold tracking-tight">Kalender</h1>
        <div role="tablist" aria-label="Ansicht" className="flex rounded-md border p-0.5">
          {(["month", "week"] as Mode[]).map((m) => (
            <Button key={m} role="tab" aria-selected={mode === m} variant={mode === m ? "secondary" : "ghost"} size="sm"
              onClick={() => setMode(m)}>{m === "month" ? "Monat" : "Woche"}</Button>
          ))}
        </div>
        <Button variant="ghost" size="icon" aria-label={mode === "month" ? "Vorheriger Monat" : "Vorherige Woche"} onClick={() => step(-1)}><ChevronLeft /></Button>
        <Button variant="outline" onClick={() => setCursor(today)}>Heute</Button>
        <Button variant="ghost" size="icon" aria-label={mode === "month" ? "Nächster Monat" : "Nächste Woche"} onClick={() => step(1)}><ChevronRight /></Button>
        <h2 className="mr-auto text-lg font-medium" aria-live="polite">{title}</h2>
        <Button onClick={() => create(sameDay(cursor, today) || mode === "week" ? today : cursor)}><Plus /> Termin</Button>
        <ThemeToggle />
      </header>

      {mode === "month" ? (
        <MonthView days={days} month={cursor.getMonth()} today={today} events={events ?? []} subj={subj}
          onCreate={create} onOpen={setEditing}
          onDay={(d) => { setCursor(d); setMode("week"); }} />
      ) : (
        <WeekView days={days} today={today} events={events ?? []} subj={subj} onCreate={create} onOpen={setEditing}
          lessons={lessons ?? []} onLesson={(id) => void openLessonSubject(id, go)} />
      )}

      <EventDialog
        event={editing}
        subjects={subjects ?? []}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(e) => void mutate(() => api.saveEvent(e), reload)}
        onDelete={(e) => void mutate(() => api.deleteEvent(e.id), reload)}
      />
    </div>
  );
}

interface ViewProps {
  days: Date[]; today: Date; events: CalendarEvent[]; subj: Map<string, Subject>;
  onCreate: (d: Date, hour?: number) => void; onOpen: (e: CalendarEvent) => void;
}

function MonthView({ days, month, today, events, subj, onCreate, onOpen, onDay }: ViewProps & { month: number; onDay: (d: Date) => void }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-2">
      <div className="grid grid-cols-7 text-center text-sm font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid flex-1 auto-rows-[minmax(7rem,1fr)] grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border" role="grid" aria-label="Monatsansicht">
        {days.map((d) => {
          const list = eventsOn(events, d);
          const isToday = sameDay(d, today);
          return (
            <div key={d.getTime()} role="gridcell"
              className={`flex min-w-0 flex-col gap-0.5 bg-background p-1 ${d.getMonth() !== month ? "bg-muted/40 text-muted-foreground" : ""}`}
              onDoubleClick={() => onCreate(d)}>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => onDay(d)} aria-label={`Woche mit ${fmtDate(d.getTime())} öffnen`}
                  className={`flex size-11 items-center justify-center rounded-full text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 ${isToday ? "bg-primary font-semibold text-primary-foreground hover:bg-primary/90" : ""}`}>
                  {d.getDate()}
                </button>
                <button type="button" onClick={() => onCreate(d)} aria-label={`Termin am ${fmtDate(d.getTime())} anlegen`}
                  className="flex size-11 items-center justify-center rounded-md text-muted-foreground opacity-40 outline-none hover:bg-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <Plus className="size-4" />
                </button>
              </div>
              {list.slice(0, 3).map((e) => <EventChip key={e.id} e={e} subject={e.subjectId ? subj.get(e.subjectId) : undefined} onClick={() => onOpen(e)} />)}
              {list.length > 3 && (
                <button type="button" onClick={() => onDay(d)} className="min-h-11 rounded text-left text-xs text-muted-foreground hover:underline">
                  +{list.length - 3} weitere
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function WeekView({ days, today, events, subj, onCreate, onOpen, lessons, onLesson }: ViewProps & { lessons: Lesson[]; onLesson: (subjectId: string) => void }) {
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const [now] = useState(() => new Date());
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto p-2" aria-label="Wochenansicht">
      <div className="grid grid-cols-[3rem_repeat(7,minmax(7rem,1fr))] gap-px">
        <div />
        {days.map((d) => (
          <div key={d.getTime()} className={`rounded-t-md py-1 text-center text-sm ${sameDay(d, today) ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"}`}>
            {WEEKDAYS[(d.getDay() + 6) % 7]} {d.getDate()}.
          </div>
        ))}
        {/* Ganztägig */}
        <div className="pt-3 pr-1 text-right text-xs text-muted-foreground">ganzt.</div>
        {days.map((d) => (
          <div key={d.getTime()} className="flex min-h-12 flex-col gap-0.5 border-b bg-muted/30 p-0.5" onDoubleClick={() => onCreate(d)}>
            {eventsOn(events, d).filter(isAllDay).map((e) => (
              <EventChip key={e.id} e={e} subject={e.subjectId ? subj.get(e.subjectId) : undefined} onClick={() => onOpen(e)} showTime={false} />
            ))}
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-[3rem_repeat(7,minmax(7rem,1fr))] gap-px">
        <div>
          {hours.map((h) => <div key={h} style={{ height: HOUR_PX }} className="-translate-y-2 pr-1 text-right text-xs tabular-nums text-muted-foreground">{h}:00</div>)}
        </div>
        {days.map((d) => {
          const timed = eventsOn(events, d).filter((e) => !isAllDay(e));
          const dayLessons = lessons.filter((l) => sameDay(new Date(l.start), d));
          return (
            <div key={d.getTime()} className="relative border-l" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <button key={h} type="button" aria-label={`Termin am ${fmtDate(d.getTime())} um ${h}:00 anlegen`}
                  onClick={() => onCreate(d, h)} style={{ height: HOUR_PX }}
                  className="block w-full border-t border-border/60 outline-none hover:bg-accent/40 focus-visible:bg-accent/60" />
              ))}
              {sameDay(d, now) && now.getHours() >= FIRST_HOUR && now.getHours() < LAST_HOUR && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
                  style={{ top: (now.getHours() - FIRST_HOUR + now.getMinutes() / 60) * HOUR_PX }} />
              )}
              {daySlots(dayLessons).filter((x) => x.kind === "free").map((x) => {
                const s = new Date(x.start), en = new Date(x.end);
                const a = s.getHours() + s.getMinutes() / 60, b = en.getHours() + en.getMinutes() / 60;
                if (x.kind !== "free" || b <= FIRST_HOUR || a >= LAST_HOUR) return null;
                return (
                  <div key={`free:${x.start}`} data-testid="free-period" data-reason={x.reason}
                    aria-label={`Freistunde ${fmtTime(x.start)}${x.reason === "cancelled" ? " (Entfall)" : ""}`}
                    className="nf-free pointer-events-none absolute left-0.5 w-[calc(50%-2px)] overflow-hidden rounded border-l-4 border-dashed px-1 text-[11px] leading-tight"
                    style={{ top: (Math.max(FIRST_HOUR, a) - FIRST_HOUR) * HOUR_PX, height: Math.max(22, (Math.min(LAST_HOUR, b) - Math.max(FIRST_HOUR, a)) * HOUR_PX - 1) }}>
                    <span className="block truncate font-medium">Freistunde</span>
                    <span className="block truncate text-muted-foreground">{x.reason === "cancelled" ? "Entfall" : "Lücke"}</span>
                  </div>
                );
              })}
              {dayLessons.filter((l) => !daySlots(dayLessons).some((x) => x.kind === "free" && x.lesson === l)).map((l) => {
                const s = new Date(l.start), en = new Date(l.end);
                const a = s.getHours() + s.getMinutes() / 60, b = en.getHours() + en.getMinutes() / 60;
                if (b <= FIRST_HOUR || a >= LAST_HOUR) return null;
                const sub = l.subjectId ? subj.get(l.subjectId) : undefined;
                const cancelled = l.state === "cancelled";
                const label = sub?.name ?? (l.subjectLong || l.subjectName);
                return (
                  <button key={`${l.id}:${l.start}`} type="button" data-testid="lesson"
                    aria-label={`Stunde ${fmtTime(l.start)} ${label}${cancelled ? " entfällt" : ""}${sub ? " – Fach öffnen" : ""}`}
                    onClick={() => (sub ? onLesson(sub.id) : onCreate(d, s.getHours()))}
                    className={`absolute left-0.5 w-[calc(50%-2px)] overflow-hidden rounded border-l-4 bg-muted px-1 text-left text-[11px] leading-tight text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 ${cancelled ? "line-through opacity-60" : ""} ${l.state === "irregular" ? "text-destructive" : ""}`}
                    style={{ top: (Math.max(FIRST_HOUR, a) - FIRST_HOUR) * HOUR_PX, height: Math.max(44, (Math.min(LAST_HOUR, b) - Math.max(FIRST_HOUR, a)) * HOUR_PX - 1), borderLeftColor: sub?.color ?? "var(--border)" }}>
                    <span className="block truncate font-medium text-foreground">{label}</span>
                    <span className="block truncate">{cancelled ? "entfällt" : l.rooms}</span>
                  </button>
                );
              })}
              {timed.map((e) => {
                const s = new Date(e.start);
                const startH = sameDay(s, d) ? s.getHours() + s.getMinutes() / 60 : FIRST_HOUR;
                const endT = e.end ?? e.start + 45 * 60_000;
                const en = new Date(endT);
                const endH = sameDay(en, d) ? en.getHours() + en.getMinutes() / 60 : LAST_HOUR;
                const top = (Math.max(FIRST_HOUR, Math.min(LAST_HOUR - 0.5, startH)) - FIRST_HOUR) * HOUR_PX;
                const h = Math.max(44, (Math.min(LAST_HOUR, endH) - Math.max(FIRST_HOUR, startH)) * HOUR_PX);
                return (
                  <div key={e.id} className={`absolute right-0.5 ${dayLessons.length ? "left-1/2" : "left-0.5"} overflow-hidden [&>button]:h-full [&>button]:items-start [&>button]:pt-1`} style={{ top, height: h }}>
                    <EventChip e={e} subject={e.subjectId ? subj.get(e.subjectId) : undefined} onClick={() => onOpen(e)} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {lessons.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Kein Stundenplan.</p>}
    </main>
  );
}
