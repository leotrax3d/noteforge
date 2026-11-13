import type { DotCounts } from "@/lib/timetable";
import { cn } from "@/lib/utils";

const DOTS: { key: keyof DotCounts; cls: string; label: string }[] = [
  { key: "cancelled", cls: "bg-red-600 text-white", label: "Ausfälle" },
  { key: "free", cls: "bg-green-600 text-white", label: "Freistunden" },
  { key: "substitution", cls: "bg-amber-400 text-black", label: "Vertretungen" },
];

/**
 * Notification Dots für das Stundenplan-Menü: rot = Ausfälle, grün = Freistunden, gelb = Vertretungen
 * (Anzahl heute + morgen). Unabhängig vom Auslöser, damit sie an jedem Menü-Button sitzen können.
 */
export function ScheduleDots({ counts, className }: { counts: DotCounts; className?: string }) {
  const shown = DOTS.filter((d) => counts[d.key] > 0);
  if (!shown.length) return null;
  return (
    <span className={cn("pointer-events-none flex gap-0.5", className)} data-testid="schedule-dots">
      {shown.map((d) => (
        <span key={d.key} data-dot={d.key} title={`${counts[d.key]} ${d.label} heute/morgen`}
          className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tabular-nums shadow-sm ring-2 ring-background", d.cls)}>
          {counts[d.key] > 9 ? "9+" : counts[d.key]}
        </span>
      ))}
    </span>
  );
}

/** Text für Screenreader/Tooltip des Menü-Buttons. */
export function dotsLabel(c: DotCounts): string {
  const parts = DOTS.filter((d) => c[d.key] > 0).map((d) => `${c[d.key]} ${d.label}`);
  return parts.length ? ` (heute/morgen: ${parts.join(", ")})` : "";
}
