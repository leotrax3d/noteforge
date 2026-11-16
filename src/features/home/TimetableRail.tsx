import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CalendarDays, EyeOff, Eye, MoreVertical, PanelRightClose, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { daySlots, useMappingDialog, type Lesson } from "@/lib/integrations";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { useNow } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { useNav } from "@/store/nav";
import { lessonLabel, useHiddenLessons } from "@/store/hidden-lessons";
import { DAY, fmtTime, startOfDay } from "@/features/calendar/dates";
import { openLessonSubject } from "./TodayTimetable";
import { useDayLessons } from "./use-lessons";

/** Tag relativ zu heute als Überschrift: „Heute“, „Gestern“, „Morgen“ oder Wochentag + Datum. */
export function dayTitle(day: number, today: number): string {
  const diff = Math.round((day - today) / DAY);
  const date = new Date(day).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
  if (diff === 0) return `Heute · ${date}`;
  if (diff === -1) return `Gestern · ${date}`;
  if (diff === 1) return `Morgen · ${date}`;
  return date;
}

/** Nächster/vorheriger Schultag (Wochenende überspringen). */
export function stepDay(day: number, dir: 1 | -1): number {
  let d = new Date(day);
  do d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir);
  while (d.getDay() === 0 || d.getDay() === 6);
  return d.getTime();
}

/**
 * WebUntis als senkrechte Seitenleiste (Desktop, rechter Rand): Tag vor/zurück, auch vergangene Tage,
 * „Heute“, Fächer als „Nicht belegt“ ausblenden und wieder einblenden.
 */
export function TimetableRail({ className, onCollapse }: { className?: string; onCollapse?: () => void }) {
  const now = useNow();
  const today = startOfDay(new Date(now)).getTime();
  const [day, setDay] = useState<number | null>(null);
  const shown = day ?? today;
  const data = useDayLessons(shown);
  const { data: subjects } = useAsync(() => api.listSubjects(), []);
  const subj = useMemo(() => new Map((subjects ?? []).map((s) => [s.id, s])), [subjects]);
  const { hidden, hide, show } = useHiddenLessons();
  const [showHidden, setShowHidden] = useState(false);
  const go = useNav((s) => s.go);
  const isToday = shown === today;
  const slots = useMemo(() => daySlots(data?.lessons ?? []), [data]);

  if (!data?.connected) return null;

  return (
    <aside aria-label="Stundenplan" data-testid="timetable-rail" data-glass="side"
      className={cn("flex w-72 shrink-0 flex-col border-l bg-muted/30", className)}>
      <div className="flex items-center gap-1 border-b p-1">
        <Button variant="ghost" size="icon" aria-label="Vorheriger Schultag" title="Vorheriger Schultag" onClick={() => setDay(stepDay(shown, -1))}><ChevronLeft /></Button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-semibold" data-testid="rail-day" aria-live="polite">{dayTitle(shown, today)}</h2>
        <Button variant="ghost" size="icon" aria-label="Nächster Schultag" title="Nächster Schultag" onClick={() => setDay(stepDay(shown, 1))}><ChevronRight /></Button>
      </div>
      <div className="flex items-center gap-1 border-b px-1 py-1">
        <Button variant={isToday ? "secondary" : "outline"} className="h-11 flex-1" disabled={isToday} onClick={() => setDay(null)} data-testid="rail-today">Heute</Button>
        {onCollapse && <Button variant="ghost" size="icon" aria-label="Stundenplan ausblenden" title="Stundenplan ausblenden" onClick={onCollapse}><PanelRightClose /></Button>}
        <Button variant="ghost" size="icon" aria-label="Woche im Kalender" title="Woche im Kalender" onClick={() => go({ view: "calendar", date: shown })}><CalendarDays /></Button>
      </div>

      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label={`Stunden ${dayTitle(shown, today)}`}>
        {data && slots.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Kein Unterricht laut WebUntis.</li>}
        {slots.map((x) => {
          if (x.kind !== "lesson") {
            return (
              <li key={`${x.kind}:${x.start}`} className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
                <span className="w-11 shrink-0 tabular-nums">{fmtTime(x.start)}</span>
                {x.kind === "lunch" ? <><Utensils className="size-3.5" aria-hidden /> Mittag</> : x.reason === "cancelled" ? "Entfall – frei" : "Freistunde"}
              </li>
            );
          }
          const l: Lesson = x.lesson;
          const s = l.subjectId ? subj.get(l.subjectId) : undefined;
          const cancelled = l.state === "cancelled";
          const running = isToday && l.start <= now && now < l.end && !cancelled;
          return (
            <li key={`${l.id}:${l.start}`} data-testid="rail-lesson"
              className={cn("flex items-stretch rounded-md border-l-4 bg-card shadow-sm", running && "ring-2 ring-primary", l.end < now && !running && "opacity-70")}
              style={{ borderLeftColor: s?.color ?? "var(--border)" }}>
              <button type="button" className="flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => (s ? void openLessonSubject(s.id, go) : useMappingDialog.getState().show(l.untisSubjectId))}
                aria-label={`${fmtTime(l.start)} ${s?.name ?? lessonLabel(l)}${cancelled ? " (entfällt)" : ""}${s ? " – Fach öffnen" : " – nicht zugeordnet"}`}>
                <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(l.start)} – {fmtTime(l.end)}</span>
                <span className={cn("w-full truncate text-sm font-medium", cancelled && "line-through")}>{s?.name ?? lessonLabel(l)}</span>
                <span className={cn("w-full truncate text-xs", cancelled ? "font-medium text-destructive" : l.state === "irregular" ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                  {cancelled ? "entfällt" : l.state === "irregular" ? `Vertretung${l.info ? `: ${l.info}` : ""}` : !s ? "Nicht zugeordnet" : [l.rooms, l.teachers].filter(Boolean).join(" · ")}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-auto min-h-11" aria-label={`Optionen für ${lessonLabel(l)}`}><MoreVertical /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{lessonLabel(l)}</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => hide(l)} data-testid="rail-hide"><EyeOff /> Nicht belegt – ausblenden</DropdownMenuItem>
                  {l.untisSubjectId != null && <DropdownMenuItem onSelect={() => useMappingDialog.getState().show(l.untisSubjectId)}>Fach zuordnen …</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ol>

      {hidden.length > 0 && (
        <div className="border-t p-1">
          <Button variant="ghost" className="h-11 w-full justify-between text-sm" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)} data-testid="rail-hidden-toggle">
            <span className="flex items-center gap-2"><EyeOff className="size-4" /> Nicht belegt ({hidden.length})</span>
            <ChevronDown className={cn("size-4 transition-transform", showHidden && "rotate-180")} />
          </Button>
          {showHidden && (
            <ul className="max-h-48 overflow-y-auto">
              {hidden.map((h) => (
                <li key={h.key} className="flex items-center gap-1 pl-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{h.label}</span>
                  <Button variant="ghost" className="h-11" onClick={() => show(h.key)} aria-label={`${h.label} wieder einblenden`}><Eye /> Einblenden</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

const RAIL_KEY = "noteforge-rail";
/** Seitenleiste im Editor ein-/ausgeblendet (pro Gerät gespeichert, Standard: ein). */
export function useRailOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(RAIL_KEY) !== "0"; } catch { return true; } });
  return [open, (v) => { setOpen(v); try { localStorage.setItem(RAIL_KEY, v ? "1" : "0"); } catch { /* nur Sitzung */ } }];
}
