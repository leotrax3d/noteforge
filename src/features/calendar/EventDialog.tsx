import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CalendarEvent, EventKind, Subject } from "@/lib/types";
import { DEFAULT_REMINDER, KIND_LABEL, REMINDERS, fromInputs, toDateInput, toTimeInput } from "./dates";

const selectCls =
  "h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const KINDS: EventKind[] = ["exam", "test", "deadline", "other"];

export function newEvent(start: number, type: EventKind = "exam", subjectId: string | null = null): CalendarEvent {
  return { id: "", subjectId, type, title: "", start, end: null, note: "", source: "manual", remindBefore: DEFAULT_REMINDER[type] };
}

interface Props {
  event: CalendarEvent | null;
  subjects: Subject[];
  onOpenChange: (open: boolean) => void;
  onSave: (e: CalendarEvent) => void;
  onDelete: (e: CalendarEvent) => void;
}

export function EventDialog({ event, subjects, onOpenChange, onSave, onDelete }: Props) {
  const [v, setV] = useState<CalendarEvent | null>(event);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [remindTouched, setRemindTouched] = useState(false);

  useEffect(() => {
    if (!event) return;
    setV(event);
    setDate(toDateInput(event.start));
    const d = new Date(event.start);
    setTime(d.getHours() || d.getMinutes() || event.end ? toTimeInput(event.start) : "");
    setEndTime(event.end ? toTimeInput(event.end) : "");
    setRemindTouched(!!event.id);
  }, [event]);

  if (!v) return null;
  const set = (p: Partial<CalendarEvent>) => setV({ ...v, ...p });
  const start = date ? fromInputs(date, time) : NaN;
  const end = date && time && endTime ? fromInputs(date, endTime) : null;
  const err = !v.title.trim() ? "Titel fehlt" : Number.isNaN(start) ? "Datum fehlt" : end != null && end < start ? "Ende liegt vor dem Beginn" : null;

  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (err) return;
            onSave({ ...v, title: v.title.trim(), start, end });
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{v.id ? "Termin bearbeiten" : "Neuer Termin"}</DialogTitle>
            <DialogDescription className="sr-only">Termin mit Typ, Fach, Datum und Erinnerung</DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label="Typ" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map((k) => (
              <Button key={k} type="button" role="radio" aria-checked={v.type === k}
                variant={v.type === k ? "default" : "outline"}
                onClick={() => set({ type: k, remindBefore: remindTouched ? v.remindBefore : DEFAULT_REMINDER[k] })}>
                {KIND_LABEL[k]}
              </Button>
            ))}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ev-title">Titel</Label>
            <Input id="ev-title" autoFocus value={v.title} placeholder="z. B. Klassenarbeit Bruchrechnung"
              onChange={(e) => set({ title: e.target.value })} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ev-subject">Fach</Label>
            <select id="ev-subject" className={selectCls} value={v.subjectId ?? ""}
              onChange={(e) => set({ subjectId: e.target.value || null })}>
              <option value="">Kein Fach</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <div className="grid gap-2">
              <Label htmlFor="ev-date">Datum</Label>
              <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-time">Beginn</Label>
              <Input id="ev-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ev-end">Ende</Label>
              <Input id="ev-end" type="time" value={endTime} disabled={!time} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-sm text-muted-foreground">Ohne Uhrzeit gilt der Termin ganztägig.</p>

          <div className="grid gap-2">
            <Label htmlFor="ev-remind">Erinnerung (Windows-Benachrichtigung)</Label>
            <select id="ev-remind" className={selectCls} value={v.remindBefore ?? ""}
              onChange={(e) => { setRemindTouched(true); set({ remindBefore: e.target.value === "" ? null : Number(e.target.value) }); }}>
              {REMINDERS.map((r) => <option key={String(r.value)} value={r.value ?? ""}>{r.label}</option>)}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ev-note">Notiz</Label>
            <textarea id="ev-note" rows={3} value={v.note} placeholder="Themen, Hilfsmittel …"
              onChange={(e) => set({ note: e.target.value })}
              className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
          </div>

          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <DialogFooter className="gap-2">
            {v.id && (
              <Button type="button" variant="ghost" className="mr-auto text-destructive"
                onClick={() => { onDelete(v); onOpenChange(false); }}>
                <Trash2 /> Löschen
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={!!err}>Speichern</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
