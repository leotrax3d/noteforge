import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { integrations, suggestMatch, useSyncRev, type MoodleCourse, type UntisSubject } from "@/lib/integrations";
import type { Subject } from "@/lib/types";

const selectCls =
  "h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
type Map = Record<string, { untis: number | null; moodle: number | null }>;

/** Ordnet Noteforge-Fächern WebUntis-Fächer und Moodle-Kurse zu (SPEC §8 „Fach-Mapping“). */
export function MappingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [untis, setUntis] = useState<UntisSubject[]>([]);
  const [courses, setCourses] = useState<MoodleCourse[] | null>(null);
  const [map, setMap] = useState<Map>({});
  const [note, setNote] = useState<string | null>(null);
  const bump = useSyncRev((s) => s.bump);

  useEffect(() => {
    if (!open) return;
    setNote(null);
    void (async () => {
      const [ss, st] = await Promise.all([api.listSubjects(), integrations.status()]);
      setSubjects(ss);
      setMap(Object.fromEntries(ss.map((s) => [s.id, { untis: s.webuntisSubjectId, moodle: s.moodleCourseId }])));
      setUntis(st.untis ? await integrations.untisSubjects().catch(() => []) : []);
      if (st.moodle) {
        integrations.moodleCourses().then(setCourses, (e) => { setCourses([]); setNote(`Moodle-Kurse konnten nicht geladen werden: ${e}`); });
      } else setCourses(null);
    })();
  }, [open]);

  const suggest = () =>
    setMap((m) => Object.fromEntries(subjects.map((s) => {
      const cur = m[s.id];
      const u = cur.untis ?? suggestMatch(s.name, untis, (x) => [x.longName, x.name])?.id ?? null;
      const c = cur.moodle ?? suggestMatch(s.name, courses ?? [], (x) => [x.fullname, x.shortname, x.fullname.split(/\s+/)[0]])?.id ?? null;
      return [s.id, { untis: u, moodle: c }];
    })));

  const save = async () => {
    const changed = subjects.filter((s) => map[s.id].untis !== s.webuntisSubjectId || map[s.id].moodle !== s.moodleCourseId);
    for (const s of changed) await api.updateSubject(s.id, { webuntisSubjectId: map[s.id].untis, moodleCourseId: map[s.id].moodle });
    bump();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fächer zuordnen</DialogTitle>
          <DialogDescription className="sr-only">Welches WebUntis-Fach und welcher Moodle-Kurs gehören zu welchem Fach in Noteforge?</DialogDescription>
        </DialogHeader>
        {subjects.length === 0 ? (
          <p className="text-muted-foreground">Lege zuerst Fächer auf der Startseite an.</p>
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-y-1 text-sm">
            <thead className="text-left text-muted-foreground">
              <tr><th className="w-1/4 font-medium">Fach</th><th className="font-medium">WebUntis</th><th className="font-medium">Moodle-Kurs</th></tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td className="truncate pr-2 font-medium"><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: s.color }} />{s.name}</td>
                  <td className="pr-2">
                    <select aria-label={`WebUntis-Fach für ${s.name}`} className={selectCls} disabled={!untis.length}
                      value={map[s.id]?.untis ?? ""} onChange={(e) => setMap({ ...map, [s.id]: { ...map[s.id], untis: e.target.value ? Number(e.target.value) : null } })}>
                      <option value="">{untis.length ? "– keins –" : "nicht verbunden"}</option>
                      {untis.map((u) => <option key={u.id} value={u.id}>{u.longName || u.name}{u.longName && u.name ? ` (${u.name})` : ""}</option>)}
                      {map[s.id]?.untis != null && !untis.some((u) => u.id === map[s.id].untis) && <option value={map[s.id].untis!}>Fach #{map[s.id].untis}</option>}
                    </select>
                  </td>
                  <td>
                    <select aria-label={`Moodle-Kurs für ${s.name}`} className={selectCls} disabled={!courses?.length}
                      value={map[s.id]?.moodle ?? ""} onChange={(e) => setMap({ ...map, [s.id]: { ...map[s.id], moodle: e.target.value ? Number(e.target.value) : null } })}>
                      <option value="">{courses === null ? "nicht verbunden" : courses.length ? "– keiner –" : "lädt …"}</option>
                      {courses?.map((c) => <option key={c.id} value={c.id}>{c.fullname}</option>)}
                      {map[s.id]?.moodle != null && !courses?.some((c) => c.id === map[s.id].moodle) && <option value={map[s.id].moodle!}>Kurs #{map[s.id].moodle}</option>}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {note && <p className="text-sm text-destructive">{note}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={suggest} disabled={!subjects.length}><Wand2 /> Automatisch vorschlagen</Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="button" onClick={() => void save().catch((e) => setNote(String(e)))}>Speichern</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
