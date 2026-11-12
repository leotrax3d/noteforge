import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ExternalLink, MoreVertical, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { api, inTauri } from "@/lib/api";
import { dueLabel, emptyHomework, school, type Homework } from "@/lib/school";
import { integrations, syncNow, useSyncRev } from "@/lib/integrations";
import { useCloudRev } from "@/lib/sync";
import type { Subject } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";
import { useNav } from "@/store/nav";
import { DAY, fromInputs, toDateInput } from "@/features/calendar/dates";
import { DoneToggle, SubjectSelect } from "./common";

const SHOW_DONE_DAYS = 14;

type Group = "overdue" | "today" | "tomorrow" | "week" | "later" | "none" | "done";
const GROUP_LABEL: Record<Group, string> = {
  overdue: "Überfällig", today: "Heute", tomorrow: "Morgen", week: "Diese Woche", later: "Später", none: "Ohne Termin",
  done: `Erledigt (letzte ${SHOW_DONE_DAYS} Tage)`,
};

function groupOf(h: Homework, now: number): Group {
  if (h.doneAt != null) return "done";
  if (h.due == null) return "none";
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const t = d0.getTime();
  if (h.due < now && h.due < t) return "overdue";
  if (h.due < t + DAY) return "today";
  if (h.due < t + 2 * DAY) return "tomorrow";
  if (h.due < t + 7 * DAY) return "week";
  return "later";
}

export function useHomework() {
  const rev = useSyncRev((s) => s.rev);
  const cloud = useCloudRev((s) => s.rev);
  return useAsync(() => school.listHomework(Date.now() - SHOW_DONE_DAYS * DAY), [rev, cloud]);
}

export function openLink(url: string) {
  if (inTauri) void openUrl(url).catch(console.error);
  else window.open(url, "_blank", "noopener");
}

/** Hausaufgaben-Liste: eigene Aufgaben plus übernommene Moodle-Abgaben. */
export function HomeworkPage({ subjectId }: { subjectId?: string }) {
  const go = useNav((s) => s.go);
  const { data: subjects } = useAsync(() => api.listSubjects(), []);
  const { data, setData, reload, error } = useHomework();
  const [filter, setFilter] = useState<string | null>(subjectId ?? null);
  const [showDone, setShowDone] = useState(true);
  const [editing, setEditing] = useState<Homework | null>(null);
  const [draft, setDraft] = useState({ title: "", subjectId: subjectId ?? null as string | null, date: toDateInput(Date.now() + DAY) });
  const [moodle, setMoodle] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const now = Date.now();

  useEffect(() => { void integrations.status().then((s) => setMoodle(!!s.moodle)).catch(() => setMoodle(false)); }, []);

  const subj = useMemo(() => new Map((subjects ?? []).map((s) => [s.id, s])), [subjects]);
  const groups = useMemo(() => {
    const m = new Map<Group, Homework[]>();
    for (const h of data ?? []) {
      if (filter && h.subjectId !== filter) continue;
      const g = groupOf(h, now);
      if (g === "done" && !showDone) continue;
      m.set(g, [...(m.get(g) ?? []), h]);
    }
    return (Object.keys(GROUP_LABEL) as Group[]).filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, showDone, Math.floor(now / 60_000)]);
  const open = (data ?? []).filter((h) => h.doneAt == null && (!filter || h.subjectId === filter)).length;

  const toggle = async (h: Homework, done: boolean) => {
    setData((d) => d?.map((x) => (x.id === h.id ? { ...x, doneAt: done ? Date.now() : null } : x)) ?? d); // optimistisch
    try { await school.setHomeworkDone(h.id, done); } catch (e) { setMsg(String(e)); }
    await reload();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    try {
      await school.saveHomework({ ...emptyHomework(draft.subjectId), title: draft.title, due: draft.date ? fromInputs(draft.date, "08:00") : null });
      setDraft((d) => ({ ...d, title: "" }));
      setMsg(null);
    } catch (err) { setMsg(String(err)); }
    await reload();
  };

  const pullMoodle = async () => {
    setSyncing(true); setMsg(null);
    try {
      const r = await syncNow(true);
      setMsg(r.errors.length ? r.errors.join(" · ") : `Moodle abgeglichen: ${r.deadlines ?? 0} Abgaben.`);
    } catch (e) { setMsg(String(e)); }
    setSyncing(false);
    await reload();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-2 py-1">
        <Button variant="ghost" size="icon" aria-label="Zurück" onClick={() => go({ view: "home" })}><ArrowLeft /></Button>
        <h1 className="mr-auto ml-1 text-lg font-semibold">Hausaufgaben <span className="text-muted-foreground font-normal">· {open} offen</span></h1>
        {moodle && (
          <Button variant="ghost" disabled={syncing} onClick={() => void pullMoodle()} title="Abgaben aus Moodle übernehmen">
            <RefreshCw className={syncing ? "animate-spin" : undefined} /> Moodle-Abgaben
          </Button>
        )}
        <Button variant="ghost" onClick={() => go({ view: "grades" })}>Noten</Button>
        <ThemeToggle />
      </header>

      <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-end gap-2 border-b p-3" aria-label="Neue Hausaufgabe">
        <div className="grid min-w-56 flex-1 gap-1">
          <Label htmlFor="hw-title">Neue Aufgabe</Label>
          <Input id="hw-title" placeholder="z. B. S. 42 Nr. 3a–c" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="hw-subj">Fach</Label>
          <SubjectSelect id="hw-subj" subjects={subjects ?? []} value={draft.subjectId} onChange={(v) => setDraft({ ...draft, subjectId: v })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="hw-due">Bis</Label>
          <Input id="hw-due" type="date" className="h-11" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </div>
        <Button type="submit" className="h-11" disabled={!draft.title.trim()}><Plus /> Hinzufügen</Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" role="toolbar" aria-label="Filter">
        <SubjectSelect subjects={subjects ?? []} value={filter} onChange={setFilter} empty="Alle Fächer" />
        <label className="flex h-11 items-center gap-2 px-2 text-sm">
          <input type="checkbox" className="size-5" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Erledigte zeigen
        </label>
        {moodle === false && <span className="ml-auto text-sm text-muted-foreground">Moodle verbinden (Startseite → Konten), um Abgaben automatisch zu übernehmen.</span>}
      </div>

      <main className="flex-1 overflow-auto p-3">
        {(error || msg) && <p role="status" className={cn("mb-3 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error ?? msg}</p>}
        {groups.length === 0 && data && <p className="p-6 text-center text-muted-foreground">Keine Hausaufgaben – schön!</p>}
        {groups.map(([g, list]) => (
          <section key={g} className="mb-4" aria-label={GROUP_LABEL[g]}>
            <h2 className={cn("mb-1 px-1 text-sm font-medium", g === "overdue" ? "text-destructive" : "text-muted-foreground")}>
              {GROUP_LABEL[g]} <span className="tabular-nums">({list.length})</span>
            </h2>
            <ul className="divide-y rounded-xl border">
              {list.map((h) => (
                <HomeworkRow key={h.id} h={h} subject={h.subjectId ? subj.get(h.subjectId) : undefined} now={now}
                  onToggle={(d) => void toggle(h, d)} onEdit={() => setEditing(h)}
                  onDelete={() => void school.deleteHomework(h.id).then(reload, (e) => setMsg(String(e)))} />
              ))}
            </ul>
          </section>
        ))}
      </main>

      <HomeworkDialog item={editing} subjects={subjects ?? []} onClose={() => setEditing(null)}
        onSave={async (h) => { await school.saveHomework(h); setEditing(null); await reload(); }} />
    </div>
  );
}

export function HomeworkRow({ h, subject, now, onToggle, onEdit, onDelete, compact }: {
  h: Homework; subject?: Subject; now: number; onToggle: (done: boolean) => void;
  onEdit?: () => void; onDelete?: () => void; compact?: boolean;
}) {
  const due = dueLabel(h.due, now);
  const done = h.doneAt != null;
  return (
    <li className="flex items-center gap-1 px-1 py-0.5" data-testid="homework">
      <DoneToggle done={done} onChange={onToggle} label={`${h.title} erledigt`} color={subject?.color} />
      <button type="button" disabled={!onEdit} onClick={onEdit} className="min-h-11 min-w-0 flex-1 rounded-md px-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <div className={cn("truncate", done && "text-muted-foreground line-through")}>{h.title}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {subject && <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: subject.color }} />{subject.name}</span>}
          {!done && (
            <span className={cn("flex items-center gap-1", due.tone === "overdue" && "font-medium text-destructive", due.tone === "soon" && "text-amber-700 dark:text-amber-400")}>
              <CalendarClock className="size-3.5" />{due.text}
            </span>
          )}
          {h.source === "moodle" && <span className="rounded bg-muted px-1.5 text-xs">Moodle</span>}
          {!compact && h.note && <span className="truncate">{h.note.split("\n")[0]}</span>}
        </div>
      </button>
      {!compact && h.url && (
        <Button variant="ghost" size="icon" aria-label="In Moodle öffnen" title="In Moodle öffnen" onClick={() => openLink(h.url)}><ExternalLink /></Button>
      )}
      {!compact && (onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Optionen für ${h.title}`}><MoreVertical /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && <DropdownMenuItem onSelect={onEdit}><Pencil /> Bearbeiten</DropdownMenuItem>}
            {onDelete && <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 /> {h.source === "moodle" ? "Ausblenden" : "Löschen"}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function HomeworkDialog({ item, subjects, onClose, onSave }: {
  item: Homework | null; subjects: Subject[]; onClose: () => void; onSave: (h: Homework) => Promise<void>;
}) {
  const [f, setF] = useState<Homework | null>(item);
  const [date, setDate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF(item); setErr(null); setDate(item?.due != null ? toDateInput(item.due) : ""); }, [item]);
  const moodle = f?.source === "moodle";
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hausaufgabe bearbeiten</DialogTitle>
          <DialogDescription>{moodle ? "Aus Moodle übernommen – Titel und Frist kommen aus Moodle." : "Eigene Aufgabe"}</DialogDescription>
        </DialogHeader>
        {f && (
          <form id="hw-form" className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const due = moodle ? f.due : date ? fromInputs(date, f.due != null ? new Date(f.due).toTimeString().slice(0, 5) : "08:00") : null;
            void onSave({ ...f, due }).catch((x) => setErr(String(x)));
          }}>
            <div className="grid gap-1"><Label htmlFor="hwd-title">Aufgabe</Label>
              <Input id="hwd-title" disabled={moodle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1"><Label htmlFor="hwd-subj">Fach</Label>
                <SubjectSelect id="hwd-subj" subjects={subjects} value={f.subjectId} onChange={(v) => setF({ ...f, subjectId: v })} /></div>
              <div className="grid gap-1"><Label htmlFor="hwd-due">Bis</Label>
                <Input id="hwd-due" type="date" className="h-11" disabled={moodle} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <div className="grid gap-1"><Label htmlFor="hwd-note">Notiz</Label>
              <textarea id="hwd-note" rows={4} className="rounded-md border bg-background p-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          </form>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button type="submit" form="hw-form">Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
