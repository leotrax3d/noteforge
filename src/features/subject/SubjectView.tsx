import { useCallback, useState } from "react";
import { ArrowLeft, FileText, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { api } from "@/lib/api";
import { subjectIcon } from "@/lib/catalog";
import { mutate, useAsync } from "@/lib/use-async";
import { useNav } from "@/store/nav";
import { cn } from "@/lib/utils";
import { CanvasPlaceholder } from "./CanvasPlaceholder";
import { Sidebar, type SidebarActions } from "./Sidebar";

export function SubjectView({ subjectId, pageId }: { subjectId: string; pageId: string | null }) {
  const go = useNav((s) => s.go);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
            <CanvasPlaceholder
              key={page.id}
              page={page}
              onRename={(title) => void mutate(() => api.updatePage(page.id, { title }), reload)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileText className="size-10" />
              <p>{sections.length ? "Wähle links ein Blatt aus oder lege ein neues an." : "Lege links eine Themengruppe an."}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
