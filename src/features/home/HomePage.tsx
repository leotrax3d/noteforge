import { useLabels } from "@/store/labels";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Logo } from "@/components/common/Logo";
import { BookCheck, Bug, Command, CalendarDays, GraduationCap, KeyRound, MoreVertical, Pencil, Plus, RefreshCw, Search, Settings, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/dialogs";
import { api } from "@/lib/api";
import { arrayMove } from "@/lib/tree";
import { subjectIcon } from "@/lib/catalog";
import type { Subject } from "@/lib/types";
import { mutate, useAsync } from "@/lib/use-async";
import { useCloudRev } from "@/lib/sync";
import { usePrefs } from "@/store/prefs";
import { useNav } from "@/store/nav";
import { openSoon } from "@/lib/utils";
import { SubjectDialog } from "./SubjectDialog";
import { UpcomingExams } from "./UpcomingExams";
import { TodayTimetable, openLessonSubject } from "./TodayTimetable";
import { useAutoSync, useLessonWindow } from "./use-lessons";
import { useNow } from "@/lib/clock";
import { runningLesson } from "@/lib/timetable";
import { SchoolWidgets } from "./SchoolWidgets";
import { AccountsDialog } from "@/features/settings/AccountsDialog";
import { useMappingDialog, useSyncRev } from "@/lib/integrations";
import { BugReportDialog } from "@/features/feedback/BugReportDialog";

export function useDragSensors() {
  return useSensors(
    // Maus/Stift: kurze Strecke, damit Tippen ein Klick bleibt.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Finger: langes Drücken, damit Scrollen möglich bleibt.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function NavButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  const on = useLabels((s) => s.on);
  return <Button variant="ghost" size={on ? "default" : "icon"} className={on ? "h-11" : "size-11"} aria-label={label} title={`${label} (Alt: Beschriftung)`} onClick={onClick}>{icon}{on && label}</Button>;
}

export function HomePage() {
  const go = useNav((s) => s.go);
  const cloudRev = useCloudRev((s) => s.rev);
  const cloudRunning = useCloudRev((s) => s.running);
  const cloudError = useCloudRev((s) => s.error);
  const setDialog = usePrefs((s) => s.setDialog);
  const syncRev = useSyncRev((s) => s.rev);
  const [bugOpen, setBugOpen] = useState(false);
  const { data: subjects, setData, error, reload } = useAsync(() => api.listSubjects(), [cloudRev, syncRev]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const [accounts, setAccounts] = useState(false);
  const sensors = useDragSensors();
  const now = useNow();
  useAutoSync();
  const untis = useLessonWindow(now, [subjects]);
  const running = untis ? runningLesson(untis.lessons, now) : null;
  const activeId = running?.subjectId ?? null;
  // Laufende Stunde: Fach an erster Stelle (nur Anzeige, gespeicherte Reihenfolge bleibt)
  const shown = useMemo(() => {
    const list = subjects ?? [];
    const a = list.find((s) => s.id === activeId);
    return a ? [a, ...list.filter((s) => s !== a)] : list;
  }, [subjects, activeId]);
  // Optional: aktives Fach bei Stundenbeginn automatisch öffnen (einmal pro Stunde)
  const autoOpen = usePrefs((s) => s.autoOpenLesson);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!autoOpen || !running?.subjectId) return;
    const key = `${running.id}:${running.start}`;
    if (opened.current === key || sessionStorage.getItem("nf-auto-opened") === key) return;
    opened.current = key;
    try { sessionStorage.setItem("nf-auto-opened", key); } catch { /* egal */ }
    void openLessonSubject(running.subjectId, go);
  }, [autoOpen, running, go]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!subjects || !over || active.id === over.id) return;
    const from = subjects.findIndex((s) => s.id === active.id);
    const to = subjects.findIndex((s) => s.id === over.id);
    const next = arrayMove(subjects, from, to);
    setData(next); // optimistisch
    void mutate(() => api.reorderSubjects(next.map((s) => s.id)), reload);
  };

  return (
    <div className="flex h-full flex-col">
      <header data-glass="bar" className="flex min-w-0 items-center gap-1 border-b px-4 py-2">
        <h1 className="mr-auto flex items-center gap-2 text-xl font-semibold tracking-tight"><Logo size={32} /> Noteforge</h1>
        <Button variant="ghost" size="icon" aria-label="Befehlspalette" onClick={() => usePrefs.getState().setDialog("palette")}><Command /></Button>
        <NavButton label="Suche" icon={<Search />} onClick={() => go({ view: "search" })} />
        <NavButton label="Kalender" icon={<CalendarDays />} onClick={() => go({ view: "calendar" })} />
        <NavButton label="Hausaufgaben" icon={<BookCheck />} onClick={() => go({ view: "homework" })} />
        <NavButton label="Noten" icon={<GraduationCap />} onClick={() => go({ view: "grades" })} />
        <NavButton label="Tags" icon={<Tags />} onClick={() => go({ view: "tags" })} />
        <NavButton label="Konten" icon={<KeyRound />} onClick={() => setAccounts(true)} />
        <Button variant="outline" className="h-11 border-primary/40 text-primary hover:bg-primary/10" title="Fehler an die Entwickler melden"
          onClick={() => setBugOpen(true)} data-testid="bug-report-button">
          <Bug /> <span className="max-sm:sr-only">Bug melden</span>
        </Button>
        <Button variant="ghost" size="icon" aria-label="Einstellungen" title={cloudError ? `Sync: ${cloudError}` : "Einstellungen (Strg+,)"}
          className="relative" onClick={() => setDialog("settings")}>
          {cloudRunning ? <RefreshCw className="animate-spin" /> : <Settings />}
          {cloudError && <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" />}
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {untis?.connected && <TodayTimetable subjects={subjects ?? []} lessons={untis.lessons} now={now} />}
        <UpcomingExams subjects={subjects ?? []} now={now} />
        <SchoolWidgets subjects={subjects ?? []} lessons={untis?.lessons ?? []} now={now} />
        <h2 className="mb-4 text-lg font-medium">Meine Fächer</h2>
        {error && <p className="mb-4 text-destructive">{error}</p>}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((s) => s.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4" aria-label="Fächer">
              {shown.map((s) => (
                <SubjectTile
                  key={s.id}
                  subject={s}
                  active={s.id === activeId}
                  onOpen={() => go({ view: "subject", subjectId: s.id, pageId: null })}
                  onEdit={() => setEditing(s)}
                  onDelete={() => setDeleting(s)}
                />
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
                >
                  <Plus className="size-8" />
                  <span className="font-medium">Fach anlegen</span>
                </button>
              </li>
            </ul>
          </SortableContext>
        </DndContext>
      </main>

      <SubjectDialog
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(v) => void mutate(() => api.createSubject(v.name, v.color, v.icon), reload)}
      />
      <SubjectDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        initial={editing ?? undefined}
        onSubmit={(v) => editing && void mutate(() => api.updateSubject(editing.id, v), reload)}
      />
      <BugReportDialog open={bugOpen} onOpenChange={setBugOpen} />
      <AccountsDialog open={accounts} onOpenChange={setAccounts} onMapping={() => { setAccounts(false); useMappingDialog.getState().show(); }} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`„${deleting?.name}“ löschen?`}
        description="Alle Themen und Blätter dieses Fachs werden endgültig gelöscht."
        onConfirm={() => deleting && void mutate(() => api.deleteSubject(deleting.id), reload)}
      />
    </div>
  );
}

function SubjectTile(props: { subject: Subject; active?: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const { subject: s } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const Icon = subjectIcon(s.icon);
  const [menu, setMenu] = useState(false);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={props.active ? "relative rounded-xl ring-4 ring-primary ring-offset-2 ring-offset-background" : "relative"}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={props.onOpen}
        aria-label={`${s.name} öffnen${props.active ? " (Unterricht läuft gerade)" : ""}`}
        data-active={props.active || undefined}
        aria-roledescription="sortierbare Kachel"
        onContextMenu={(e) => { e.preventDefault(); openSoon(setMenu); }}
        data-glass="tile"
        className="nf-tile-subject relative flex aspect-[4/3] w-full touch-manipulation flex-col justify-between rounded-xl p-4 text-left text-white shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/70 data-[dragging=true]:shadow-xl"
        data-dragging={isDragging}
        style={{ background: s.color, ["--subject" as string]: s.color }}
      >
        <span className="nf-tile-icon"><Icon className="size-9 opacity-90" /></span>
        {props.active && (
          <span data-testid="active-lesson-badge" className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-black shadow">
            <span className="size-2 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none" aria-hidden /> Jetzt
          </span>
        )}
        <span className="line-clamp-2 text-lg font-semibold">{s.name}</span>
      </button>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Optionen für ${s.name}`} title="Optionen (Rechtsklick / lange drücken)"
            className="absolute top-1 right-1 text-white hover:bg-white/20 hover:text-white [html.glass_&]:top-3 [html.glass_&]:right-3 [html.glass_&]:text-foreground [html.glass_&]:hover:text-foreground">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={props.onEdit}><Pencil /> Bearbeiten</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={props.onDelete}><Trash2 /> Löschen</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
