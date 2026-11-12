import type { CalendarEvent, Subject } from "@/lib/types";
import { KIND_SHORT, fmtTime, isAllDay } from "./dates";

const KIND_STYLE: Record<CalendarEvent["type"], string> = {
  exam: "font-semibold",
  test: "",
  deadline: "border-dashed border",
  other: "opacity-90",
};

/** Kompakter Termin-Chip (Monat/Woche), Farbe = Fachfarbe. */
export function EventChip({ e, subject, onClick, showTime = true }: {
  e: CalendarEvent; subject?: Subject; onClick: () => void; showTime?: boolean;
}) {
  const color = subject?.color ?? "var(--muted-foreground)";
  const short = KIND_SHORT[e.type];
  return (
    <button
      type="button"
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      title={`${e.title}${subject ? " · " + subject.name : ""}`}
      className={`flex min-h-11 w-full items-center gap-1 truncate rounded-md px-1.5 text-left text-xs text-white outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 ${KIND_STYLE[e.type]}`}
      style={{ background: color, borderColor: "white" }}
    >
      {showTime && !isAllDay(e) && <span className="tabular-nums opacity-90">{fmtTime(e.start)}</span>}
      {short && <span className="rounded bg-white/25 px-1">{short}</span>}
      <span className="truncate">{e.title}</span>
    </button>
  );
}
