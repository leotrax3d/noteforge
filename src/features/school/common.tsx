import { Check } from "lucide-react";
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
