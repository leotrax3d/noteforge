import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CalendarEvent, EventKind, PageRef, Subject } from "@/lib/types";
import { api } from "@/lib/api";
import { gcal, type HistoryEntry } from "@/lib/gcal";
import { useSetup } from "@/store/setup";
import { DEFAULT_REMINDER, KIND_LABEL, REMINDERS, fromInputs, toDateInput, toTimeInput } from "./dates";

const selectCls =
  "h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const KINDS: EventKind[] = ["exam", "test", "deadline", "other"];

export function newEvent(start: number, type: EventKind = "exam", subjectId: string | null = null): CalendarEvent {
  return { id: "", subjectId, type, title: "", start, end: null, note: "", source: "manual", remindBefore: defaultReminder(type) };
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
  const [pages, setPages] = useState<PageRef[]>([]);
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  useEffect(() => { if (event) void api.listPageRefs().then(setPages).catch(() => {}); }, [event]);
  useEffect(() => {
    setHist([]);
    if (event?.id) void gcal.history(event.id).then(setHist).catch(() => {});
  }, [event]);

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
                onClick={() => set({ type: k, remindBefore: remindTouched ? v.remindBefore : defaultReminder(k) })}>
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

          <div className="grid gap-2">
            <Label htmlFor="ev-page">Blatt</Label>
            <select id="ev-page" className={selectCls} value={v.pageId ?? ""}
              onChange={(e) => set({ pageId: e.target.value || null })}>
              <option value="">Kein Blatt</option>
              {pages.filter((p) => !v.subjectId || p.subjectId === v.subjectId).map((p) => (
                <option key={p.pageId} value={p.pageId}>{v.subjectId ? p.title || "Unbenannt" : `${p.subjectName} · ${p.title || "Unbenannt"}`}</option>
              ))}
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

          {hist.length > 0 && (
            <details className="rounded-md border px-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Verlauf ({hist.length})</summary>
              <ul className="grid gap-1 pb-2">
                {hist.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted-foreground">{new Date(h.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} · {h.reason}: </span>
                      {h.event.title} · {new Date(h.event.start).toLocaleDateString("de-DE")}
                    </span>
                    <Button type="button" variant="ghost" className="h-11" onClick={() => void gcal.restore(h.id).then((e) => { setV(e); setDate(toDateInput(e.start)); onSave(e); onOpenChange(false); })}>Wiederherstellen</Button>
                  </li>
                ))}
              </ul>
            </details>
          )}

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

/** Standard-Erinnerung; sonstige Termine nach Assistent/Einstellungen. */
function defaultReminder(k: EventKind): number | null {
  return k === "other" ? useSetup.getState().reminderLead : DEFAULT_REMINDER[k];
}
