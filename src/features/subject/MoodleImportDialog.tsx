import { useEffect, useState } from "react";
import { FileDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { integrations, type MoodleCourse, type MoodleFile } from "@/lib/integrations";
import type { Subject } from "@/lib/types";
import { fmtDate } from "@/features/calendar/dates";

const selectCls =
  "h-11 w-full rounded-md border bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** PDFs aus dem zugeordneten Moodle-Kurs auswählen; Import läuft wie bei lokalen PDFs. */
export function MoodleImportDialog({ open, onOpenChange, subject, onImport }: {
  open: boolean; onOpenChange: (o: boolean) => void; subject: Subject | undefined;
  onImport: (bytes: ArrayBuffer, fileName: string) => void;
}) {
  const [courses, setCourses] = useState<MoodleCourse[]>([]);
  const [course, setCourse] = useState<number | null>(null);
  const [files, setFiles] = useState<MoodleFile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null); setFiles(null);
    void (async () => {
      const st = await integrations.status();
      if (!st.moodle) { setErr("Moodle ist nicht verbunden. Richte es auf der Startseite unter „Konten“ ein."); return; }
      try {
        const cs = await integrations.moodleCourses();
        setCourses(cs);
        setCourse(subject?.moodleCourseId ?? cs[0]?.id ?? null);
      } catch (e) { setErr(String(e)); }
    })();
  }, [open, subject?.moodleCourseId]);

  useEffect(() => {
    if (!open || course == null) return;
    setFiles(null);
    integrations.moodleFiles(course).then(setFiles, (e) => setErr(String(e)));
  }, [open, course]);

  const pick = async (f: MoodleFile) => {
    setLoading(f.fileurl); setErr(null);
    try {
      const bytes = await integrations.moodleDownload(f.fileurl);
      onOpenChange(false);
      onImport(bytes, f.filename);
    } catch (e) { setErr(String(e)); } finally { setLoading(null); }
  };

  const sections = [...new Set((files ?? []).map((f) => f.section))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>PDF aus Moodle importieren</DialogTitle>
          <DialogDescription>Die Datei wird als neues A4-Blatt angelegt, auf dem du direkt schreiben kannst.</DialogDescription>
        </DialogHeader>
        {courses.length > 0 && (
          <select aria-label="Moodle-Kurs" className={selectCls} value={course ?? ""} onChange={(e) => setCourse(Number(e.target.value))}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.fullname}{c.id === subject?.moodleCourseId ? " (zugeordnet)" : ""}</option>)}
          </select>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {files === null && !err && course != null && <p className="text-muted-foreground">Lade Dateien …</p>}
        {files?.length === 0 && <p className="text-muted-foreground">In diesem Kurs gibt es keine PDFs.</p>}
        {sections.map((sec) => (
          <section key={sec} className="grid gap-1">
            <h3 className="text-sm font-medium text-muted-foreground">{sec || "Allgemein"}</h3>
            <ul className="grid gap-1">
              {files!.filter((f) => f.section === sec).map((f) => (
                <li key={f.fileurl}>
                  <Button variant="ghost" className="h-auto min-h-11 w-full justify-start text-left" disabled={!!loading} onClick={() => void pick(f)}>
                    {loading === f.fileurl ? <FileDown className="animate-pulse" /> : <FileText />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{f.filename}</span>
                      <span className="block truncate text-xs text-muted-foreground">{f.module} · {kb(f.filesize)}{f.modified ? ` · ${fmtDate(f.modified, false)}` : ""}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
