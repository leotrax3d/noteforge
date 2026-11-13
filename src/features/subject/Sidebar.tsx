import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import {
  DndContext, DragOverlay, pointerWithin, closestCenter, useDraggable, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown, ChevronRight, CornerDownRight, FileText, FilePlus, FolderPlus, GripVertical,
  FileUp, GraduationCap, IndentDecrease, IndentIncrease, LayoutTemplate, MoreVertical, Palette, Pencil, Trash2, Wand2,
  Bookmark, BookmarkMinus, LayoutGrid, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, NameDialog } from "@/components/common/dialogs";
import { useDragSensors } from "@/features/home/HomePage";
import { arrayMove, flattenSection, indentTarget, outdentTarget, pageDropTarget, type PageDrop } from "@/lib/tree";
import type { Page, Section } from "@/lib/types";
import { cn, openSoon } from "@/lib/utils";

/** Horizontaler Zugweg (px), ab dem ein Blatt als Unterblatt abgelegt wird. */
export const NEST_THRESHOLD = 40;
const INDENT = 16;

export interface SidebarActions {
  selectPage(id: string): void;
  createSection(name: string, color: string): void;
  updateSection(id: string, patch: { name?: string; color?: string }): void;
  deleteSection(id: string): void;
  reorderSections(ids: string[]): void;
  createPage(sectionId: string, parentPageId: string | null): void;
  deletePage(id: string): void;
  movePage(id: string, drop: PageDrop): void;
  createFromTemplate(sectionId: string, parentPageId: string | null): void;
  importPdf(sectionId: string): void;
  importMoodle(sectionId: string): void;
  openTrash(): void;
  renamePage(id: string, title: string): void;
  restoreAutoTitle(id: string): void;
  toggleBookmark(id: string): void;
}

interface Props {
  subjectColor: string;
  sections: Section[];
  pages: Page[];
  selectedPageId: string | null;
  actions: SidebarActions;
  /** Blatt, dessen Name gerade inline bearbeitet wird (F2, Doppeltipp, Kontextmenü) */
  renamingId: string | null;
  onRenaming: (id: string | null) => void;
}

type DragId = `s:${string}` | `p:${string}`;
const parse = (id: string | number) => ({ kind: String(id)[0] as "s" | "p", id: String(id).slice(2) });

// Gruppen sortieren nur gegen Gruppen; Blätter bevorzugen das Element unter dem Zeiger.
const collision: CollisionDetection = (args) => {
  const kind = parse(args.active.id).kind;
  if (kind === "s") {
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => parse(c.id).kind === "s") });
  }
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

export function Sidebar({ subjectColor, sections, pages, selectedPageId, actions, renamingId, onRenaming }: Props) {
  const sensors = useDragSensors();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ active: string; over: string | null; nest: boolean } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "new-section" }
    | { kind: "rename-section"; section: Section }
    | { kind: "delete-section"; section: Section }
    | { kind: "delete-page"; page: Page }
    | null
  >(null);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const flat = useMemo(
    () => new Map(sections.map((s) => [s.id, flattenSection(pages, s.id, collapsed)])),
    [sections, pages, collapsed],
  );

  // Vorschau des Ablegeziels für die Anzeige.
  const preview = useMemo(() => {
    if (!drag?.over) return null;
    const a = parse(drag.active), o = parse(drag.over);
    if (a.kind !== "p") return null;
    if (o.kind === "s") return { overId: drag.over, mode: "into" as const };
    const t = pageDropTarget(pages, a.id, o.id, drag.nest);
    if (!t) return null;
    const active = pages.find((p) => p.id === a.id)!;
    const over = pages.find((p) => p.id === o.id)!;
    const below = !drag.nest && active.sectionId === over.sectionId &&
      active.parentPageId === over.parentPageId && active.order < over.order;
    return { overId: drag.over, mode: drag.nest ? ("nest" as const) : below ? ("below" as const) : ("above" as const) };
  }, [drag, pages]);

  const onDragStart = (e: DragStartEvent) => setDrag({ active: String(e.active.id), over: null, nest: false });
  const onDragMove = (e: DragMoveEvent) =>
    setDrag((d) => {
      const over = e.over ? String(e.over.id) : null;
      const nest = e.delta.x > NEST_THRESHOLD;
      return d && (d.over !== over || d.nest !== nest) ? { ...d, over, nest } : d;
    });
  const onDragEnd = (e: DragEndEvent) => {
    const nest = e.delta.x > NEST_THRESHOLD;
    setDrag(null);
    if (!e.over) return;
    const a = parse(e.active.id), o = parse(e.over.id);
    if (a.kind === "s" && o.kind === "s" && a.id !== o.id) {
      const ids = sections.map((s) => s.id);
      actions.reorderSections(arrayMove(ids, ids.indexOf(a.id), ids.indexOf(o.id)));
    } else if (a.kind === "p" && o.kind === "s") {
      const top = pages.filter((p) => p.sectionId === o.id && p.parentPageId === null && p.id !== a.id).length;
      actions.movePage(a.id, { sectionId: o.id, parentPageId: null, index: top });
    } else if (a.kind === "p" && o.kind === "p") {
      const t = pageDropTarget(pages, a.id, o.id, nest);
      if (t) actions.movePage(a.id, t);
    }
  };

  const [view, setViewState] = useState<SideView>(() => {
    try { const v = localStorage.getItem(VIEW_KEY); return v === "grid" || v === "bookmarks" ? v : "list"; } catch { return "list"; }
  });
  const setView = (v: SideView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* egal */ } };

  const activeItem = drag && parse(drag.active);
  const activeLabel =
    activeItem?.kind === "s"
      ? sections.find((s) => s.id === activeItem.id)?.name
      : pages.find((p) => p.id === activeItem?.id)?.title || "Unbenanntes Blatt";

  return (
    <nav aria-label="Themen und Blätter" className="flex h-full flex-col">
      {/* Ansicht wie in GoodNotes: Raster · Liste · Lesezeichen */}
      <div role="tablist" aria-label="Ansicht der Seitenleiste" className="mx-2 mt-2 flex shrink-0 rounded-xl bg-muted p-1">
        {([["grid", "Raster", <LayoutGrid key="g" />], ["list", "Liste", <List key="l" />], ["bookmarks", "Lesezeichen", <Bookmark key="b" />]] as const).map(([v, label, icon]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} aria-label={label} title={label} onClick={() => setView(v)}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-lg text-muted-foreground transition-colors [&_svg]:size-5",
              view === v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground")}>
            {icon}
          </button>
        ))}
      </div>
      {view === "grid" && <PageGrid sections={sections} pages={pages} selectedPageId={selectedPageId} actions={actions} />}
      {view === "bookmarks" && <BookmarkList sections={sections} pages={pages} selectedPageId={selectedPageId} actions={actions} />}
      <div className={cn("flex-1 overflow-y-auto overscroll-contain p-2", view !== "list" && "hidden")}>
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
        >
          {sections.map((sec) => (
            <SectionBlock
              key={sec.id}
              section={sec}
              items={flat.get(sec.id) ?? []}
              collapsed={collapsed}
              onToggle={toggle}
              selectedPageId={selectedPageId}
              preview={preview}
              draggingId={drag?.active ?? null}
              pages={pages}
              actions={actions}
              onRename={() => setDialog({ kind: "rename-section", section: sec })}
              onDelete={() => setDialog({ kind: "delete-section", section: sec })}
              onDeletePage={(page) => setDialog({ kind: "delete-page", page })}
              renamingId={renamingId}
              onRenaming={onRenaming}
            />
          ))}
          <DragOverlay dropAnimation={null}>
            {activeLabel && (
              <div className="flex h-11 items-center gap-2 rounded-md border bg-popover px-3 text-sm shadow-lg">
                <GripVertical className="size-4 text-muted-foreground" />
                {activeLabel}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {sections.length === 0 && (
          <EmptyState compact icon={<FolderPlus />} title="Noch keine Themen" text="Themen bündeln die Blätter eines Fachs, z. B. „Funktionen“."
            action="Thema anlegen" onAction={() => setDialog({ kind: "new-section" })} />
        )}
      </div>
      <div className="flex border-t p-2">
        <Button variant="ghost" className="flex-1 justify-start" onClick={() => setDialog({ kind: "new-section" })}>
          <FolderPlus /> Thema
        </Button>
        <Button variant="ghost" onClick={actions.openTrash}>
          <Trash2 /> Papierkorb
        </Button>
      </div>

      <NameDialog
        open={dialog?.kind === "new-section"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Neues Thema"
        initialColor={subjectColor}
        withColor
        submitLabel="Anlegen"
        onSubmit={(name, color) => actions.createSection(name, color)}
      />
      <NameDialog
        open={dialog?.kind === "rename-section"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Thema bearbeiten"
        initial={dialog?.kind === "rename-section" ? dialog.section.name : ""}
        initialColor={dialog?.kind === "rename-section" ? dialog.section.color : subjectColor}
        withColor
        onSubmit={(name, color) => dialog?.kind === "rename-section" && actions.updateSection(dialog.section.id, { name, color })}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete-section"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`„${dialog?.kind === "delete-section" ? dialog.section.name : ""}“ löschen?`}
        description="Das Thema und alle enthaltenen Blätter werden endgültig gelöscht."
        onConfirm={() => dialog?.kind === "delete-section" && actions.deleteSection(dialog.section.id)}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete-page"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`„${dialog?.kind === "delete-page" ? dialog.page.title || "Unbenanntes Blatt" : ""}“ löschen?`}
        description="Das Blatt und alle Unterblätter kommen in den Papierkorb und können 30 Tage lang wiederhergestellt werden."
        confirmLabel="In den Papierkorb"
        onConfirm={() => dialog?.kind === "delete-page" && actions.deletePage(dialog.page.id)}
      />
    </nav>
  );
}

type SideView = "grid" | "list" | "bookmarks";
const VIEW_KEY = "noteforge-sidebar-view";

/** Miniatur eines Blatts: Papier in Blattfarbe mit angedeutetem Hintergrund (Karo/Linien/Punkte). */
function PaperThumb({ page }: { page: Page }) {
  const step = 8;
  const bg = page.background === "grid"
    ? `linear-gradient(#94a3b833 1px, transparent 1px) 0 0 / ${step}px ${step}px, linear-gradient(90deg, #94a3b833 1px, transparent 1px) 0 0 / ${step}px ${step}px`
    : page.background === "lines" ? `linear-gradient(#94a3b844 1px, transparent 1px) 0 0 / 100% ${step}px`
    : page.background === "dots" ? `radial-gradient(#94a3b877 0.8px, transparent 1px) 0 0 / ${step}px ${step}px` : "none";
  const landscape = page.mode === "a4" && page.orientation === "landscape";
  return (
    <span className={cn("block w-full rounded-md border shadow-sm", landscape ? "aspect-[297/210]" : "aspect-[210/297]")}
      style={{ background: `${bg === "none" ? "" : bg + ","} ${page.pageColor || "#ffffff"}` }} />
  );
}

function PageGrid({ sections, pages, selectedPageId, actions }: { sections: Section[]; pages: Page[]; selectedPageId: string | null; actions: SidebarActions }) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
      {sections.map((sec) => {
        const list = pages.filter((p) => p.sectionId === sec.id).sort((a, b) => a.order - b.order);
        return (
          <section key={sec.id} aria-label={sec.name}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <span className="size-2.5 rounded-full" style={{ background: sec.color }} />{sec.name}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {list.map((p) => (
                <button key={p.id} type="button" onClick={() => actions.selectPage(p.id)} aria-current={p.id === selectedPageId ? "page" : undefined}
                  className={cn("group relative flex flex-col gap-1 rounded-lg p-1 text-left", p.id === selectedPageId ? "ring-2 ring-[var(--subject,var(--ring))]" : "hover:bg-accent")}>
                  <PaperThumb page={p} />
                  {p.bookmarked && <Bookmark className="absolute top-1.5 right-2.5 size-4 fill-red-500 text-red-500" aria-label="Lesezeichen" />}
                  <span className={cn("truncate px-0.5 text-xs", p.titleSource === "auto" && "italic text-muted-foreground")}>{p.title || "Unbenannt"}</span>
                </button>
              ))}
              {list.length === 0 && <span className="col-span-2 text-xs text-muted-foreground">Keine Blätter</span>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BookmarkList({ sections, pages, selectedPageId, actions }: { sections: Section[]; pages: Page[]; selectedPageId: string | null; actions: SidebarActions }) {
  const marked = pages.filter((p) => p.bookmarked);
  if (!marked.length) return (
    <div className="flex-1 p-3">
      <EmptyState compact icon={<Bookmark />} title="Keine Lesezeichen" text="Im Menü eines Blatts (⋮) „Lesezeichen setzen“ wählen." />
    </div>
  );
  return (
    <ul className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
      {marked.map((p) => {
        const sec = sections.find((s) => s.id === p.sectionId);
        return (
          <li key={p.id} className="flex items-center">
            <button type="button" onClick={() => actions.selectPage(p.id)} aria-current={p.id === selectedPageId ? "page" : undefined}
              className={cn("flex min-h-11 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm", p.id === selectedPageId ? "bg-accent font-medium" : "hover:bg-accent")}>
              <Bookmark className="size-4 shrink-0 fill-red-500 text-red-500" />
              <span className="min-w-0 flex-1 truncate">{p.title || "Unbenannt"}</span>
              {sec && <span className="truncate text-xs text-muted-foreground">{sec.name}</span>}
            </button>
            <Button variant="ghost" size="icon" aria-label="Lesezeichen entfernen" title="Lesezeichen entfernen" onClick={() => actions.toggleBookmark(p.id)}>
              <BookmarkMinus />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

type Preview = { overId: string; mode: "above" | "below" | "nest" | "into" } | null;

function useDragDrop(id: DragId) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const ref = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };
  return { ref, attributes: drag.attributes, listeners: drag.listeners };
}

function SectionBlock(props: {
  section: Section;
  items: ReturnType<typeof flattenSection>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selectedPageId: string | null;
  preview: Preview;
  draggingId: string | null;
  pages: Page[];
  actions: SidebarActions;
  onRename: () => void;
  onDelete: () => void;
  onDeletePage: (p: Page) => void;
  renamingId: string | null;
  onRenaming: (id: string | null) => void;
}) {
  const { section: sec, actions } = props;
  const id: DragId = `s:${sec.id}`;
  const dd = useDragDrop(id);
  const [menu, setMenu] = useState(false);
  const open = !props.collapsed.has(sec.id);
  const isOver = props.preview?.overId === id;
  const dragKind = props.draggingId ? parse(props.draggingId).kind : null;

  return (
    <section className={cn("mb-1 rounded-md", props.draggingId === id && "opacity-40")}>
      <div
        ref={dd.ref}
        {...dd.attributes}
        {...dd.listeners}
        role="group"
        aria-label={`Thema ${sec.name}`}
        onContextMenu={(e) => { e.preventDefault(); openSoon(setMenu); }}
        className={cn(
          "group flex h-11 touch-manipulation items-center rounded-md hover:bg-accent/60",
          isOver && dragKind === "p" && "bg-accent ring-2 ring-primary",
          isOver && dragKind === "s" && "ring-2 ring-primary",
        )}
      >
        <Button variant="ghost" size="icon" aria-label={open ? "Einklappen" : "Ausklappen"} aria-expanded={open}
          onClick={() => props.onToggle(sec.id)}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <span className="mr-2 size-3 shrink-0 rounded-full" style={{ background: sec.color }} />
        <span className="flex-1 truncate font-medium">{sec.name}</span>
        <Button variant="ghost" size="icon" aria-label={`Blatt in ${sec.name} anlegen`}
          onClick={() => actions.createPage(sec.id, null)}>
          <FilePlus />
        </Button>
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Optionen für ${sec.name}`} title="Optionen (Rechtsklick / lange drücken)"><MoreVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => actions.createPage(sec.id, null)}><FilePlus /> Neues Blatt</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.createFromTemplate(sec.id, null)}><LayoutTemplate /> Blatt aus Vorlage …</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.importPdf(sec.id)}><FileUp /> PDF als Blatt importieren …</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.importMoodle(sec.id)}><GraduationCap /> PDF aus Moodle …</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onRename}><Palette /> Umbenennen / Farbe</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={props.onDelete}><Trash2 /> Löschen</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <ul role="tree" aria-label={sec.name}>
          {props.items.map((f) => (
            <PageRow
              key={f.page.id}
              item={f}
              collapsed={props.collapsed.has(f.page.id)}
              onToggle={() => props.onToggle(f.page.id)}
              selected={props.selectedPageId === f.page.id}
              preview={props.preview?.overId === `p:${f.page.id}` ? props.preview.mode : null}
              dragging={props.draggingId === `p:${f.page.id}`}
              pages={props.pages}
              actions={actions}
              onDelete={() => props.onDeletePage(f.page)}
              renaming={props.renamingId === f.page.id}
              onRenaming={(on) => props.onRenaming(on ? f.page.id : null)}
            />
          ))}
          {props.items.length === 0 && (
            <li className="py-2 pl-11 text-sm text-muted-foreground">Keine Blätter</li>
          )}
        </ul>
      )}
    </section>
  );
}

function PageRow(props: {
  item: ReturnType<typeof flattenSection>[number];
  collapsed: boolean;
  onToggle: () => void;
  selected: boolean;
  preview: "above" | "below" | "nest" | "into" | null;
  dragging: boolean;
  pages: Page[];
  actions: SidebarActions;
  onDelete: () => void;
  renaming: boolean;
  onRenaming: (on: boolean) => void;
}) {
  const { page, depth, hasChildren } = props.item;
  const { actions } = props;
  const dd = useDragDrop(`p:${page.id}`);
  const [menu, setMenu] = useState(false);
  const indent = indentTarget(props.pages, page.id);
  const outdent = outdentTarget(props.pages, page.id);
  const lastTap = useRef(0);
  const auto = page.titleSource === "auto";

  return (
    <li role="treeitem" aria-selected={props.selected} aria-expanded={hasChildren ? !props.collapsed : undefined}
      className="relative">
      {props.preview === "above" && <DropLine depth={depth} edge="top" />}
      {props.preview === "below" && <DropLine depth={depth} edge="bottom" />}
      <div
        ref={dd.ref}
        {...dd.attributes}
        {...dd.listeners}
        role="button"
        tabIndex={0}
        onClick={() => actions.selectPage(page.id)}
        onDoubleClick={() => props.onRenaming(true)}
        onPointerUp={(e) => {
          // Doppeltipp (Touch/Stift): zwei Tipps innerhalb von 350 ms
          if (e.pointerType === "mouse") return;
          const now = e.timeStamp;
          if (now - lastTap.current < 350) props.onRenaming(true);
          lastTap.current = now;
        }}
        onContextMenu={(e) => { e.preventDefault(); openSoon(setMenu); }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), actions.selectPage(page.id))}
        style={{ paddingLeft: 12 + depth * INDENT }}
        className={cn(
          "group flex h-11 touch-manipulation cursor-default items-center rounded-md text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          props.selected ? "bg-[color-mix(in_oklab,var(--subject)_18%,transparent)] font-medium" : "hover:bg-accent/60",
          props.preview === "nest" && "ring-2 ring-primary",
          props.dragging && "opacity-40",
        )}
      >
        {hasChildren ? (
          <Button variant="ghost" size="icon" aria-label={props.collapsed ? "Unterblätter zeigen" : "Unterblätter verbergen"}
            onClick={(e) => (e.stopPropagation(), props.onToggle())}>
            {props.collapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center text-muted-foreground">
            {depth > 0 ? <CornerDownRight className="size-4" /> : <FileText className="size-4" />}
          </span>
        )}
        {props.renaming ? (
          <InlineName initial={page.title} onCancel={() => props.onRenaming(false)}
            onCommit={(t) => { props.onRenaming(false); if (t.trim() && t.trim() !== page.title) actions.renamePage(page.id, t.trim()); }} />
        ) : (
          <span data-testid="page-title" data-source={page.titleSource}
            title={auto ? "Automatischer Titel – Doppeltippen oder F2 zum Umbenennen" : undefined}
            className={cn("flex-1 truncate", auto && "text-muted-foreground italic")}>
            {page.title || "Unbenannt"}
          </span>
        )}
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Optionen für ${page.title || "Blatt"}`} title="Optionen (Rechtsklick / lange drücken)"
              onClick={(e) => e.stopPropagation()}
              className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => actions.selectPage(page.id)}><FileText /> Öffnen</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.setTimeout(() => props.onRenaming(true), 0)}><Pencil /> Umbenennen<span className="ml-auto text-xs text-muted-foreground">F2</span></DropdownMenuItem>
            {!auto && <DropdownMenuItem onSelect={() => actions.restoreAutoTitle(page.id)}><Wand2 /> Automatischen Titel wiederherstellen</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => actions.toggleBookmark(page.id)}>
              {page.bookmarked ? <><BookmarkMinus /> Lesezeichen entfernen</> : <><Bookmark /> Lesezeichen setzen</>}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.createPage(page.sectionId, page.id)}><FilePlus /> Unterblatt hinzufügen</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.createFromTemplate(page.sectionId, page.id)}><LayoutTemplate /> Unterblatt aus Vorlage …</DropdownMenuItem>
            <DropdownMenuItem disabled={!indent} onSelect={() => indent && actions.movePage(page.id, indent)}>
              <IndentIncrease /> Einrücken
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!outdent} onSelect={() => outdent && actions.movePage(page.id, outdent)}>
              <IndentDecrease /> Ebene höher
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={props.onDelete}><Trash2 /> Löschen</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function DropLine({ depth, edge }: { depth: number; edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute right-1 z-10 h-0.5 rounded bg-primary", edge === "top" ? "-top-px" : "-bottom-px")}
      style={{ left: 12 + depth * INDENT + 8 }}
    />
  );
}

/** Inline-Eingabe für den Blattnamen: Enter/Klick daneben speichert, Esc bricht ab. */
function InlineName({ initial, onCommit, onCancel }: { initial: string; onCommit: (t: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok) onCommit(ref.current?.value ?? initial);
    else onCancel();
  };
  return (
    <input ref={ref} defaultValue={initial} aria-label="Blattname" data-testid="page-rename"
      className="mr-1 h-9 min-w-0 flex-1 rounded border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)} />
  );
}
