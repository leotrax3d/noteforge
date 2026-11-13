import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { SUBJECT_COLORS } from "@/lib/catalog";
import {
  integrations, linkUntisSubject, suggestMatch, suggestSubjectFor, useMappingDialog, useSyncRev,
  type MoodleCourse, type UntisSubject,
} from "@/lib/integrations";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

const selectCls =
  "h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const NEW = "__new__";

export const untisLabel = (u: UntisSubject) => (u.longName && u.name && u.longName !== u.name ? `${u.longName} (${u.name})` : u.longName || u.name);

/** Passt ein WebUntis-Fach zu einem Fokus (ID oder Name aus Hausaufgaben/Prüfungen)? */
export function matchesFocus(u: UntisSubject, focus: number | string | null): boolean {
  if (focus == null) return false;
  if (typeof focus === "number") return u.id === focus;
  const f = focus.trim().toLowerCase();
  return !!f && (u.name.toLowerCase() === f || u.longName.toLowerCase() === f);
}

/** Global eingehängter Zuordnungsdialog (öffnen über `useMappingDialog().show(fokus)`). */
export function GlobalMappingDialog() {
  const { open, focus, close } = useMappingDialog();
  return <MappingDialog open={open} focus={focus} onOpenChange={(o) => { if (!o) close(); }} />;
}

/**
 * Zuordnung WebUntis-Fach → Noteforge-Fach (mit Vorschlägen und „Neues Fach“) und
 * Noteforge-Fach → Moodle-Kurs (SPEC §8 „Fach-Mapping“).
 */
export function MappingDialog({ open, onOpenChange, focus = null }: { open: boolean; onOpenChange: (o: boolean) => void; focus?: number | string | null }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [untis, setUntis] = useState<UntisSubject[] | null>(null);
  const [courses, setCourses] = useState<MoodleCourse[] | null>(null);
  /** WebUntis-ID → Noteforge-Fach-ID (null = nicht zugeordnet) */
  const [umap, setUmap] = useState<Record<number, string | null>>({});
  const [mmap, setMmap] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bump = useSyncRev((s) => s.bump);
  const focusRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!open) return;
    setNote(null);
    void (async () => {
      const [ss, st] = await Promise.all([api.listSubjects(), integrations.status()]);
      setSubjects(ss);
      setMmap(Object.fromEntries(ss.map((s) => [s.id, s.moodleCourseId])));
      const us = st.untis ? await integrations.untisSubjects().catch(() => []) : null;
      setUntis(us);
      setUmap(Object.fromEntries((us ?? []).map((u) => [u.id, ss.find((s) => s.webuntisSubjectId === u.id)?.id ?? null])));
      if (st.moodle) {
        integrations.moodleCourses().then(setCourses, (e) => { setCourses([]); setNote(`Moodle-Kurse konnten nicht geladen werden: ${e}`); });
      } else setCourses(null);
    })();
  }, [open]);

  useEffect(() => { if (open && untis) focusRef.current?.scrollIntoView({ block: "center" }); }, [open, untis]);

  const suggestions = useMemo(() => {
    const taken = new Set(Object.values(umap).filter(Boolean));
    const out: Record<number, Subject | null> = {};
    for (const u of untis ?? []) {
      const s = umap[u.id] ? null : suggestSubjectFor(u, subjects.filter((x) => !taken.has(x.id)));
      out[u.id] = s;
    }
    return out;
  }, [untis, umap, subjects]);

  /** Noteforge-Fächer, die mehreren WebUntis-Fächern zugeordnet wurden (nicht erlaubt). */
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of Object.values(umap)) if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [umap]);

  const createFor = async (u: UntisSubject) => {
    const color = SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length].value;
    const s = await api.createSubject(u.longName || u.name || "Neues Fach", color, "book-open");
    setSubjects((x) => [...x, s]);
    setMmap((m) => ({ ...m, [s.id]: null }));
    setUmap((m) => ({ ...m, [u.id]: s.id }));
  };

  const acceptAll = () => {
    setUmap((m) => {
      const next = { ...m };
      const used = new Set(Object.values(m).filter(Boolean));
      for (const u of untis ?? []) {
        const s = suggestions[u.id];
        if (!next[u.id] && s && !used.has(s.id)) { next[u.id] = s.id; used.add(s.id); }
      }
      return next;
    });
    setMmap((m) => Object.fromEntries(subjects.map((s) => [s.id,
      m[s.id] ?? suggestMatch(s.name, courses ?? [], (x) => [x.fullname, x.shortname, x.fullname.split(/\s+/)[0]])?.id ?? null])));
  };

  const save = async () => {
    if (dupes.size) { setNote("Jedes Noteforge-Fach kann nur einem WebUntis-Fach zugeordnet werden."); return; }
    setBusy(true);
    try {
      // erst lösen, dann verknüpfen – so stören sich Tausch-Zuordnungen nicht
      const current = (u: UntisSubject) => subjects.find((s) => s.webuntisSubjectId === u.id)?.id ?? null;
      const changed = (untis ?? []).filter((u) => (umap[u.id] ?? null) !== current(u));
      for (const u of changed) if (current(u)) await linkUntisSubject(u.id, null);
      for (const u of changed) if (umap[u.id]) await linkUntisSubject(u.id, umap[u.id]);
      for (const s of subjects) {
        if ((mmap[s.id] ?? null) !== s.moodleCourseId) await api.updateSubject(s.id, { moodleCourseId: mmap[s.id] ?? null });
      }
      bump();
      onOpenChange(false);
    } catch (e) { setNote(String(e)); }
    setBusy(false);
  };

  const openSuggestions = Object.values(suggestions).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fächer zuordnen</DialogTitle>
          <DialogDescription>Welches Noteforge-Fach gehört zu welchem WebUntis-Fach und Moodle-Kurs?</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="map-untis">
          <h3 id="map-untis" className="mb-1 font-medium">WebUntis</h3>
          {untis === null ? <p className="text-sm text-muted-foreground">WebUntis ist nicht verbunden.</p>
            : untis.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Fächer – nach dem ersten Stundenplan-Abgleich erscheinen sie hier.</p>
            : (
              <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr><th className="w-2/5 font-medium">WebUntis-Fach</th><th className="font-medium">Noteforge-Fach</th></tr>
                </thead>
                <tbody>
                  {untis.map((u) => {
                    const val = umap[u.id] ?? null;
                    const sug = suggestions[u.id];
                    const focused = matchesFocus(u, focus);
                    return (
                      <tr key={u.id} ref={focused ? focusRef : undefined} data-testid="untis-map-row" className={cn(focused && "bg-primary/10")}>
                        <td className="pr-2 align-top">
                          <div className="flex min-h-11 flex-col justify-center">
                            <span className="truncate font-medium" title={untisLabel(u)}>{untisLabel(u)}</span>
                            {!val && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Nicht zugeordnet</span>}
                          </div>
                        </td>
                        <td className="align-top">
                          <select aria-label={`Noteforge-Fach für ${untisLabel(u)}`} className={cn(selectCls, val && dupes.has(val) && "border-destructive")}
                            value={val ?? ""} disabled={busy}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === NEW) void createFor(u).catch((x) => setNote(String(x)));
                              else setUmap({ ...umap, [u.id]: v || null });
                            }}>
                            <option value="">– nicht zugeordnet –</option>
                            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            <option value={NEW}>+ Neues Fach „{u.longName || u.name}“ anlegen</option>
                          </select>
                          {sug && (
                            <Button type="button" variant="ghost" className="mt-1 h-11 w-full justify-start text-sm" onClick={() => setUmap({ ...umap, [u.id]: sug.id })}>
                              <Check /> Vorschlag übernehmen: <span className="ml-1 inline-block size-2.5 rounded-full" style={{ background: sug.color }} />{sug.name}
                            </Button>
                          )}
                          {val && dupes.has(val) && <p className="mt-1 text-xs text-destructive">Dieses Fach ist schon einem anderen WebUntis-Fach zugeordnet.</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </section>

        {courses !== null && subjects.length > 0 && (
          <section aria-labelledby="map-moodle">
            <h3 id="map-moodle" className="mb-1 font-medium">Moodle</h3>
            <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th className="w-2/5 font-medium">Fach</th><th className="font-medium">Moodle-Kurs</th></tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.id}>
                    <td className="truncate pr-2 font-medium"><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: s.color }} />{s.name}</td>
                    <td>
                      <select aria-label={`Moodle-Kurs für ${s.name}`} className={selectCls} disabled={!courses.length || busy}
                        value={mmap[s.id] ?? ""} onChange={(e) => setMmap({ ...mmap, [s.id]: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">{courses.length ? "– keiner –" : "lädt …"}</option>
                        {courses.map((c) => <option key={c.id} value={c.id}>{c.fullname}</option>)}
                        {mmap[s.id] != null && !courses.some((c) => c.id === mmap[s.id]) && <option value={mmap[s.id]!}>Kurs #{mmap[s.id]}</option>}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {note && <p role="alert" className="text-sm text-destructive">{note}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={acceptAll} disabled={busy || (!openSuggestions && courses === null)}>
            <Wand2 /> Alle Vorschläge übernehmen{openSuggestions ? ` (${openSuggestions})` : ""}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="button" disabled={busy || dupes.size > 0} onClick={() => void save()}>Speichern</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
