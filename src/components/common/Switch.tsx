import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Switch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="mr-auto">
        <Label htmlFor={id}>{label}</Label>
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="flex h-11 w-16 shrink-0 items-center rounded-full px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className={cn("flex h-7 w-full items-center rounded-full p-0.5 transition-colors", checked ? "bg-primary" : "bg-muted-foreground/30")}>
          <span className={cn("size-6 rounded-full bg-white shadow transition-transform", checked && "translate-x-7")} />
        </span>
      </button>
    </div>
  );
}
