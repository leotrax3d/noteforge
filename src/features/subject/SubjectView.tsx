import { useCallback, useRef, useState } from "react";
import { ArrowLeft, FileText, PanelLeftClose, PanelLeftOpen, Search, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { api } from "@/lib/api";
import { subjectIcon } from "@/lib/catalog";
import { mutate, useAsync } from "@/lib/use-async";
import { useNav } from "@/store/nav";
import { cn } from "@/lib/utils";
import { CanvasView } from "@/features/canvas/CanvasView";
import type { PagePatch } from "@/lib/types";
import { Sidebar, type SidebarActions } from "./Sidebar";
import { TemplateDialog, createFromTemplate } from "@/features/pages/TemplateDialog";
import { TrashDialog } from "@/features/pages/TrashDialog";
import { layoutPdfPages, orientationOf, pdfToImages } from "@/features/pages/pdf-import";
import { objToElement } from "@/canvas/core/objects";
import { MoodleImportDialog } from "./MoodleImportDialog";

export function SubjectView({ subjectId, pageId, focus }: { subjectId: string; pageId: string | null; focus?: string }) {
  const go = useNav((s) => s.go);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tpl, setTpl] = useState<{ sectionId: string; parent: string | null } | null>(null);
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [moodleTarget, setMoodleTarget] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const pdfRef = useRef<HTMLInputElement>(null);
  const pdfTarget = useRef<string | null>(null);
  const subjects = useAsync(() => api.listSubjects(), []);
  const data = useAsync(
    async () => {
      const [sections, pages] = await Promise.all([api.listSections(subjectId), api.listPages(subjectId)]);
      return { sections, pages };
    },
    [subjectId],
  );
  const reload = data.reload;
  const subject = subjects.data?.find((s) => s.id === subjectId);
  const sections = data.data?.sections ?? [];
  const pages = data.data?.pages ?? [];
  const page = pages.find((p) => p.id === pageId) ?? null;

  const select = useCallback((id: string | null) => go({ view: "subject", subjectId, pageId: id }), [go, subjectId]);

  const actions: SidebarActions = {
    selectPage: (id) => select(id),
    createSection: (name, color) => void mutate(() => api.createSection(subjectId, name, color), reload),
    updateSection: (id, patch) => void mutate(() => api.updateSection(id, patch), reload),
    deleteSection: (id) =>
      void mutate(async () => {
        await api.deleteSection(id);
        if (page?.sectionId === id) select(null);
      }, reload),
    reorderSections: (ids) => {
      data.setData((d) => d && { ...d, sections: ids.map((i) => d.sections.find((s) => s.id === i)!) });
      void mutate(() => api.reorderSections(subjectId, ids), reload);
    },
    createPage: (sectionId, parent) =>
      void mutate(async () => select((await api.createPage(sectionId, parent, "")).id), reload),
    deletePage: (id) =>
      void mutate(async () => {
        await api.deletePage(id);
        if (pageId && (pageId === id || !(await api.listPages(subjectId)).some((p) => p.id === pageId))) select(null);
      }, reload),
    movePage: (id, t) => void mutate(() => api.movePage(id, t.sectionId, t.parentPageId, t.index), reload),
    createFromTemplate: (sectionId, parent) => setTpl({ sectionId, parent }),
    importPdf: (sectionId) => {
      pdfTarget.current = sectionId;
      pdfRef.current?.click();
    },
    importMoodle: (sectionId) => setMoodleTarget(sectionId),
    openTrash: () => setTrash(true),
  };

  /** PDF → neues A4-Blatt mit festen Hintergrundseiten. */
  const importPdf = async (bytes: ArrayBuffer, fileName: string, sectionId: string) => {
    setBusy("PDF wird gelesen …");
    try {
      const imgs = await pdfToImages(bytes, (d, n) => setBusy(`PDF-Seite ${d} von ${n} …`));
      if (!imgs.length) throw new Error("Die PDF enthält keine Seiten");
      const orientation = orientationOf(imgs[0]);
      const p = await api.createPage(sectionId, null, fileName.replace(/\.pdf$/i, ""));
      await api.updatePage(p.id, { mode: "a4", orientation, background: "blank" });
      const objs = layoutPdfPages(imgs, { mode: "a4", orientation, z: 0 });
      await api.saveElements(p.id, objs.map((o) => objToElement(o, p.id)), []);
      reload();
      select(p.id);
      setBusy(null);
    } catch (e) {
      console.error(e);
      setBusy(`PDF-Import fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
      window.setTimeout(() => setBusy(null), 4000);
    }
  };

  /** Seitenlink [[Titel]] öffnen; fehlt das Blatt, wird es in der aktuellen Themengruppe angelegt. */
  const openLink = async (title: string) => {
    try {
      const hit = await api.findPage(title, subjectId);
      if (hit) return go({ view: "subject", subjectId: hit.subjectId, pageId: hit.pageId });
      const sectionId = page?.sectionId ?? sections[0]?.id;
      if (!sectionId) return;
      const p = await api.createPage(sectionId, null, title);
      reload();
      select(p.id);
    } catch (e) {
      console.error(e);
    }
  };

  if (subjects.data && !subject) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p>Dieses Fach existiert nicht mehr.</p>
        <Button onClick={() => go({ view: "home" })}>Zur Startseite</Button>
      </div>
    );
  }

  const Icon = subjectIcon(subject?.icon ?? "");
  return (
    <div className="flex h-full flex-col" style={{ ["--subject" as string]: subject?.color ?? "var(--primary)" }}>
      <header className="flex items-center gap-1 border-b px-2 py-1" style={{ borderBottomColor: "var(--subject)" }}>
        <Button variant="ghost" size="icon" aria-label="Zur Startseite" onClick={() => go({ view: "home" })}>
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label={sidebarOpen ? "Seitenleiste ausblenden" : "Seitenleiste einblenden"}
          aria-pressed={sidebarOpen} onClick={() => setSidebarOpen((o) => !o)}>
          {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <span className="ml-1 flex size-8 items-center justify-center rounded-md text-white" style={{ background: "var(--subject)" }}>
          <Icon className="size-5" />
        </span>
        <h1 className="mr-auto ml-2 truncate text-lg font-semibold">{subject?.name}</h1>
        <Button variant="ghost" size="icon" aria-label="Suche" title="Suche (Strg+K)" onClick={() => go({ view: "search" })}><Search /></Button>
        <Button variant="ghost" size="icon" aria-label="Tag-Übersicht" title="Tags" onClick={() => go({ view: "tags" })}><Tags /></Button>
        <ThemeToggle />
      </header>
      {data.error && <p className="px-4 py-2 text-destructive">{data.error}</p>}
      <div className="flex min-h-0 flex-1">
        <aside className={cn("w-72 shrink-0 border-r bg-muted/30", !sidebarOpen && "hidden")}>
          <Sidebar
            subjectColor={subject?.color ?? "#2563eb"}
            sections={sections}
            pages={pages}
            selectedPageId={pageId}
            actions={actions}
          />
        </aside>
        <main className="min-w-0 flex-1">
          {page ? (
            <CanvasView
              key={`${page.id}:${rev}`}
              page={page}
              focus={focus}
              onOpenLink={(t) => void openLink(t)}
              onPageReplaced={() => { setRev((r) => r + 1); reload(); }}
              sections={sections}
              pages={pages}
              subjectName={subject?.name ?? ""}
              onRename={(title) => void mutate(() => api.updatePage(page.id, { title }), reload)}
              onPageChange={(patch: PagePatch) => {
                data.setData((d) => d && { ...d, pages: d.pages.map((x) => (x.id === page.id ? { ...x, ...patch } : x)) });
                void mutate(() => api.updatePage(page.id, patch), reload);
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileText className="size-10" />
              <p>{sections.length ? "Wähle links ein Blatt aus oder lege ein neues an." : "Lege links eine Themengruppe an."}</p>
            </div>
          )}
        </main>
      </div>
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden aria-hidden data-testid="pdf-page-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && pdfTarget.current) { const t = pdfTarget.current; void f.arrayBuffer().then((b) => importPdf(b, f.name, t)); }
        }} />
      <TemplateDialog open={!!tpl} onOpenChange={(o) => !o && setTpl(null)}
        onPick={(id) => tpl && void mutate(async () => select((await createFromTemplate(tpl.sectionId, tpl.parent, id)).id), reload)} />
      <MoodleImportDialog open={!!moodleTarget} onOpenChange={(o) => !o && setMoodleTarget(null)} subject={subject}
        onImport={(bytes, name) => moodleTarget && void importPdf(bytes, name, moodleTarget)} />
      <TrashDialog open={trash} onOpenChange={setTrash} subjectId={subjectId}
        onChanged={(restored) => { reload(); if (restored) select(restored); }} />
      {busy && (
        <div role="status" data-testid="subject-busy"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {busy}
        </div>
      )}
    </div>
  );
}
