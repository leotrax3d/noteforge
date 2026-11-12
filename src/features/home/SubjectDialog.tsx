import { NameDialog } from "@/components/common/dialogs";
import { Label } from "@/components/ui/label";
import { SUBJECT_ICONS } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: { name: string; color: string; icon: string };
  onSubmit: (v: { name: string; color: string; icon: string }) => void;
}

export function SubjectDialog({ open, onOpenChange, initial, onSubmit }: Props) {
  const [icon, setIcon] = useState(initial?.icon ?? "calculator");
  useEffect(() => {
    if (open) setIcon(initial?.icon ?? "calculator");
  }, [open, initial?.icon]);

  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Fach bearbeiten" : "Neues Fach"}
      label="Fachname"
      initial={initial?.name}
      initialColor={initial?.color}
      withColor
      submitLabel={initial ? "Speichern" : "Anlegen"}
      onSubmit={(name, color) => onSubmit({ name, color, icon })}
    >
      <div className="grid gap-2">
        <Label>Symbol</Label>
        <div role="radiogroup" aria-label="Symbol" className="grid grid-cols-8 gap-1">
          {Object.entries(SUBJECT_ICONS).map(([key, { icon: Icon, label }]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={icon === key}
              aria-label={label}
              title={label}
              onClick={() => setIcon(key)}
              className={cn(
                "flex size-11 items-center justify-center rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                icon === key ? "border-primary bg-accent" : "border-transparent hover:bg-accent",
              )}
            >
              <Icon className="size-5" />
            </button>
          ))}
        </div>
      </div>
    </NameDialog>
  );
}
