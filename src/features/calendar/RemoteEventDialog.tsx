// Google-Termin (nur lesend) mit optionalem Klassenarbeits-Vorschlag (SPEC §8.3).
import { useEffect, useState } from "react";
import { CalendarCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { notifyLocalChange } from "@/lib/api";
import { gcal, type RemoteEvent } from "@/lib/gcal";
import type { EventKind, Subject } from "@/lib/types";
import { fmtDate, fmtTime, KIND_LABEL } from "./dates";

const selectCls = "h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function RemoteEventDialog({ event, subjects, onOpenChange, onChanged }: {
  event: RemoteEvent | null; subjects: Subject[]; onOpenChange: (o: boolean) => void; onChanged: () => void;
}) {
  const [kind, setKind] = useState<EventKind>("exam");
  const [subjectId, setSubjectId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    setKind(event?.suggestion?.type ?? "exam");
    setSubjectId(event?.suggestion?.subjectId ?? "");
  }, [event]);
  if (!event) return null;
  const when = event.allDay ? fmtDate(event.start) : `${fmtDate(event.start)}, ${fmtTime(event.start)}${event.end ? `–${fmtTime(event.end)}` : ""}`;
  const run = (fn: () => Promise<unknown>) => void fn().then(() => { notifyLocalChange(); onChanged(); }).catch((e) => setErr(String(e).replace(/^Error: /, "")));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event.title || "(ohne Titel)"}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ background: event.color }} />
            {event.calendarName} · {when}{event.location ? ` · ${event.location}` : ""}
          </DialogDescription>
        </DialogHeader>
        {event.suggestion && (
          <div className="grid gap-3 rounded-lg border p-3" data-testid="exam-suggestion">
            <p className="text-sm font-medium">Als {KIND_LABEL[event.suggestion.type]} übernehmen?</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5"><Label htmlFor="rs-kind">Typ</Label>
                <select id="rs-kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
                  <option value="exam">{KIND_LABEL.exam}</option><option value="test">{KIND_LABEL.test}</option>
                </select></div>
              <div className="grid gap-1.5"><Label htmlFor="rs-subj">Fach</Label>
                <select id="rs-subj" className={selectCls} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">Kein Fach</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(() => gcal.adopt(event, kind, subjectId || null))}><CalendarCheck /> Übernehmen</Button>
              <Button variant="ghost" onClick={() => run(() => gcal.dismiss(event))}><X /> Kein Termin für Noteforge</Button>
            </div>
          </div>
        )}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Schließen</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
