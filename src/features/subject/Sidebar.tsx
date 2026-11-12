import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import {
  DndContext, DragOverlay, pointerWithin, closestCenter, useDraggable, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown, ChevronRight, CornerDownRight, FileText, FilePlus, FolderPlus, GripVertical,
  FileUp, GraduationCap, IndentDecrease, IndentIncrease, LayoutTemplate, MoreVertical, Palette, Pencil, Trash2,
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
}

interface Props {
  subjectColor: string;
  sections: Section[];
  pages: Page[];
  selectedPageId: string | null;
  actions: SidebarActions;
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

export function Sidebar({ subjectColor, sections, pages, selectedPageId, actions }: Props) {
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

  const activeItem = drag && parse(drag.active);
  const activeLabel =
    activeItem?.kind === "s"
      ? sections.find((s) => s.id === activeItem.id)?.name
      : pages.find((p) => p.id === activeItem?.id)?.title || "Unbenanntes Blatt";

  return (
    <nav aria-label="Themen und Blätter" className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto overscroll-contain p-2">
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
}) {
  const { page, depth, hasChildren } = props.item;
  const { actions } = props;
  const dd = useDragDrop(`p:${page.id}`);
  const [menu, setMenu] = useState(false);
  const indent = indentTarget(props.pages, page.id);
  const outdent = outdentTarget(props.pages, page.id);

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
        <span className={cn("flex-1 truncate", !page.title && "text-muted-foreground italic")}>
          {page.title || "Unbenanntes Blatt"}
        </span>
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Optionen für ${page.title || "Blatt"}`} title="Optionen (Rechtsklick / lange drücken)"
              onClick={(e) => e.stopPropagation()}
              className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => actions.selectPage(page.id)}><Pencil /> Öffnen</DropdownMenuItem>
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
