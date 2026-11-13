import { Check, Link2 } from "lucide-react";
import { useMappingDialog } from "@/lib/integrations";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

export const selectCls =
  "h-11 rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function SubjectSelect({ subjects, value, onChange, id, empty = "Ohne Fach", className }: {
  subjects: Subject[]; value: string | null; onChange: (v: string | null) => void; id?: string; empty?: string; className?: string;
}) {
  return (
    <select id={id} className={cn(selectCls, className)} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{empty}</option>
      {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

/** Runde Abhak-Fläche, 44 px Trefferfläche. */
export function DoneToggle({ done, onChange, label, color }: { done: boolean; onChange: (d: boolean) => void; label: string; color?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} onClick={() => onChange(!done)}
      className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span className={cn("flex size-7 items-center justify-center rounded-full border-2 transition-colors", done ? "border-transparent text-white" : "")}
        style={{ borderColor: done ? undefined : color ?? "var(--muted-foreground)", background: done ? color ?? "var(--primary)" : undefined }}>
        {done && <Check className="size-4" />}
      </span>
    </button>
  );
}

export const toneCls = {
  good: "text-emerald-700 dark:text-emerald-400",
  mid: "text-amber-700 dark:text-amber-400",
  bad: "text-destructive",
} as const;

/**
 * Farbiges Fach-Label. Ohne Noteforge-Fach, aber mit WebUntis-Fach: „Nicht zugeordnet“ mit direktem
 * Sprung in den Zuordnungsdialog.
 */
export function SubjectBadge({ subject, untis, className }: { subject?: Subject; untis?: string | number | null; className?: string }) {
  const show = useMappingDialog((s) => s.show);
  if (subject) {
    return (
      <span data-testid="subject-badge" className={cn("inline-flex max-w-48 items-center gap-1 rounded-full px-2 text-xs font-medium leading-5", className)}
        style={{ background: `color-mix(in srgb, ${subject.color} 18%, transparent)`, color: "inherit", boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${subject.color} 45%, transparent)` }}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: subject.color }} />
        <span className="truncate">{subject.name}</span>
      </span>
    );
  }
  if (untis == null || untis === "") return null;
  const label = typeof untis === "string" ? untis : "WebUntis-Fach";
  return (
    <button type="button" data-testid="subject-unmapped" onClick={(e) => { e.stopPropagation(); show(untis); }}
      title="WebUntis-Fach einem Noteforge-Fach zuordnen"
      className={cn("relative inline-flex max-w-56 items-center gap-1 rounded-full border border-dashed border-amber-600/60 px-2 text-xs font-medium leading-5 text-amber-800 outline-none",
        "after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-amber-300", className)}>
      <Link2 className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label} · Nicht zugeordnet</span>
    </button>
  );
}
