import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HsvPicker } from "./HsvPicker";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUBJECT_COLORS } from "@/lib/catalog";
import { Check, Plus } from "lucide-react";

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const custom = !SUBJECT_COLORS.some((c) => c.value === value);
  return (
    <div role="radiogroup" aria-label="Farbe" className="flex flex-wrap gap-1">
      {SUBJECT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          aria-label={c.label}
          title={c.label}
          onClick={() => onChange(c.value)}
          className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex size-8 items-center justify-center rounded-full" style={{ background: c.value }}>
            {value === c.value && <Check className="size-4 text-white" />}
          </span>
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Eigene Farbe" title="Eigene Farbe"
            className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="flex size-8 items-center justify-center rounded-full"
              style={{ background: custom ? value : "conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}>
              {custom ? <Check className="size-4 text-white" /> : <Plus className="size-4 text-white" />}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64"><HsvPicker value={value} onChange={onChange} /></PopoverContent>
      </Popover>
    </div>
  );
}

interface NameDialogProps {
  open: boolean;
  title: string;
  label?: string;
  initial?: string;
  initialColor?: string;
  withColor?: boolean;
  submitLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, color: string) => void;
  children?: ReactNode;
}

/** Eingabedialog für Namen (optional mit Farbwahl). */
export function NameDialog(p: NameDialogProps) {
  const [name, setName] = useState(p.initial ?? "");
  const [color, setColor] = useState(p.initialColor ?? SUBJECT_COLORS[0].value);
  useEffect(() => {
    if (p.open) {
      setName(p.initial ?? "");
      setColor(p.initialColor ?? SUBJECT_COLORS[0].value);
    }
  }, [p.open, p.initial, p.initialColor]);

  const valid = name.trim().length > 0;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            p.onSubmit(name.trim(), color);
            p.onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
            <DialogDescription className="sr-only">{p.title}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="name-input">{p.label ?? "Name"}</Label>
            <Input id="name-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {p.withColor && (
            <div className="grid gap-2">
              <Label>Farbe</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          )}
          {p.children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => p.onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={!valid}>{p.submitLabel ?? "Speichern"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmDialog(p: ConfirmProps) {
  return (
    <AlertDialog open={p.open} onOpenChange={p.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p.title}</AlertDialogTitle>
          <AlertDialogDescription>{p.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={p.onConfirm}>
            {p.confirmLabel ?? "Löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
