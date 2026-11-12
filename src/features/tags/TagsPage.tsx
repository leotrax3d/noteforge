import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, FileText, Image as ImageIcon, PenLine, Plus, Search, Table2, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NameDialog } from "@/components/common/dialogs";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { BUILTIN_TAG_IDS, type TaggedItem } from "@/lib/types";
import { useAsync } from "@/lib/use-async";
import { cn } from "@/lib/utils";
import { useNav } from "@/store/nav";
import { TAG_ICONS, tagIcon, useTagStore } from "./tag-store";

const KIND: Record<string, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: "Text" },
  table: { icon: Table2, label: "Tabelle" },
  image: { icon: ImageIcon, label: "Bild" },
  stroke: { icon: PenLine, label: "Handschrift" },
};

/** Tag-Übersicht (SPEC §5): alle markierten Stellen, To-Dos abhaken, eigene Tags. */
export function TagsPage({ tagId }: { tagId?: string }) {
  const go = useNav((s) => s.go);
  const back = useNav((s) => s.back);
  const { tags, loaded, load, create, remove } = useTagStore();
  const [filter, setFilter] = useState<string | null>(tagId ?? null);
  const [openOnly, setOpenOnly] = useState(false);
  const [newTag, setNewTag] = useState(false);
  const [icon, setIcon] = useState("bookmark");
  const items = useAsync(() => api.listTagged(filter, null), [filter]);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const shown = (items.data ?? []).filter((i) => !openOnly || (i.tagId === "todo" && !i.done));

  // Nach Fach → Blatt gruppieren
  const groups = useMemo(() => {
    const m = new Map<string, { subject: string; color: string; pages: Map<string, { title: string; section: string; items: TaggedItem[] }> }>();
    for (const i of shown) {
      const g = m.get(i.subjectId) ?? { subject: i.subjectName, color: i.subjectColor, pages: new Map() };
      m.set(i.subjectId, g);
      const p = g.pages.get(i.pageId) ?? { title: i.pageTitle, section: i.sectionName, items: [] };
      g.pages.set(i.pageId, p);
      p.items.push(i);
    }
    return [...m.entries()];
  }, [shown]);

  const toggleDone = async (i: TaggedItem) => {
    items.setData((d) => d?.map((x) => (x.elementId === i.elementId && x.tagId === i.tagId ? { ...x, done: !x.done } : x)) ?? d);
    try {
      await api.setTagDone(i.elementId, i.tagId, !i.done);
    } catch (e) {
      console.error(e);
      items.reload();
    }
  };

  const current = filter ? tagById.get(filter) : null;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-2 py-1">
        <Button variant="ghost" size="icon" aria-label="Zurück" onClick={() => go(back ?? { view: "home" })}><ArrowLeft /></Button>
        <h1 className="mr-auto ml-1 text-lg font-semibold">Tags</h1>
        <Button variant="ghost" onClick={() => go({ view: "search" })}><Search /> Suche</Button>
        <ThemeToggle />
      </header>
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2" role="toolbar" aria-label="Tag-Filter">
        <Chip active={!filter} onClick={() => setFilter(null)}>Alle</Chip>
        {tags.map((t) => {
          const I = tagIcon(t.icon);
          return (
            <Chip key={t.id} active={filter === t.id} onClick={() => setFilter(t.id)}>
              <I className="size-4" style={{ color: t.color }} /> {t.name}
            </Chip>
          );
        })}
        <Button variant="ghost" onClick={() => setNewTag(true)}><Plus /> Eigenes Tag</Button>
        <label className="ml-auto flex h-11 cursor-pointer items-center gap-2 px-2 text-sm">
          <input type="checkbox" className="size-5" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Nur offene To-Dos
        </label>
        {current && !BUILTIN_TAG_IDS.includes(current.id) && (
          <Button variant="ghost" className="text-destructive" onClick={() => void remove(current.id).then(() => setFilter(null))}>
            <Trash2 /> „{current.name}“ löschen
          </Button>
        )}
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          {items.error && <p className="text-destructive">{items.error}</p>}
          {items.data && shown.length === 0 && (
            <p className="text-muted-foreground">
              Noch nichts markiert. Wähle auf einem Blatt Inhalte mit dem Lasso aus (oder ein Textfeld) und tippe auf „Tag“.
            </p>
          )}
          {groups.map(([sid, g]) => (
            <section key={sid} className="mb-6" aria-label={g.subject}>
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <span className="size-3 rounded-full" style={{ background: g.color }} /> {g.subject}
              </h2>
              {[...g.pages.entries()].map(([pid, p]) => (
                <div key={pid} className="mb-3 rounded-md border bg-card">
                  <button type="button" className="flex min-h-11 w-full items-center gap-2 border-b px-3 text-left text-sm hover:bg-accent"
                    onClick={() => go({ view: "subject", subjectId: sid, pageId: pid })}>
                    <FileText className="size-4" /> <span className="font-medium">{p.title || "Unbenanntes Blatt"}</span>
                    <span className="text-muted-foreground">· {p.section}</span>
                  </button>
                  <ul>
                    {p.items.map((i) => {
                      const t = tagById.get(i.tagId);
                      const I = tagIcon(t?.icon ?? "");
                      const K = KIND[i.type] ?? KIND.stroke;
                      const isTodo = i.tagId === "todo";
                      return (
                        <li key={i.elementId + i.tagId} className="flex items-center gap-1 border-b last:border-b-0">
                          {isTodo ? (
                            <button type="button" role="checkbox" aria-checked={i.done} aria-label={i.done ? "Als offen markieren" : "Als erledigt markieren"}
                              onClick={() => void toggleDone(i)} className="flex size-11 shrink-0 items-center justify-center">
                              <span className={cn("flex size-6 items-center justify-center rounded border-2", i.done && "bg-primary text-primary-foreground")}
                                style={{ borderColor: t?.color }}>
                                {i.done && <Check className="size-4" />}
                              </span>
                            </button>
                          ) : (
                            <span className="flex size-11 shrink-0 items-center justify-center" title={t?.name}><I className="size-5" style={{ color: t?.color }} /></span>
                          )}
                          <button type="button" className={cn("flex min-h-11 flex-1 items-center gap-2 py-2 pr-3 text-left text-sm hover:underline", i.done && "text-muted-foreground line-through")}
                            onClick={() => go({ view: "subject", subjectId: sid, pageId: pid, focus: i.elementId })}>
                            <K.icon className="size-4 shrink-0 text-muted-foreground" aria-label={K.label} />
                            <span className="line-clamp-2">{i.snippet || K.label}</span>
                            {!filter && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t?.name}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </main>
      <NameDialog open={newTag} onOpenChange={setNewTag} title="Eigenes Tag" withColor submitLabel="Anlegen"
        onSubmit={(name, color) => void create(name, icon, color).then((t) => setFilter(t.id))}>
        <div className="grid gap-2">
          <Label>Symbol</Label>
          <div role="radiogroup" aria-label="Symbol" className="flex flex-wrap gap-1">
            {Object.entries(TAG_ICONS).map(([k, v]) => (
              <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={v.label} title={v.label}
                onClick={() => setIcon(k)}
                className={cn("flex size-11 items-center justify-center rounded-md border", icon === k && "border-primary bg-accent")}>
                <v.icon className="size-5" />
              </button>
            ))}
          </div>
        </div>
      </NameDialog>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
      {children}
    </button>
  );
}
