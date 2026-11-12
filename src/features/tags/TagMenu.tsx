import { useEffect, useState } from "react";
import { Check, Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tagIcon, useTagStore } from "./tag-store";

/** Tags an-/abschalten (Auswahl-Menü, Textfeld-Rahmen). */
export function TagMenu({ active, onToggle, className }: {
  active: Set<string>;
  onToggle: (tagId: string, on: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { tags, loaded, load } = useTagStore();
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tag" title="Tag vergeben" className={className}
          onPointerDown={(e) => e.stopPropagation()}>
          <TagIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" data-format-bar onPointerDown={(e) => e.stopPropagation()}>
        <ul role="menu" aria-label="Tags">
          {tags.map((t) => {
            const I = tagIcon(t.icon);
            const on = active.has(t.id);
            return (
              <li key={t.id}>
                <button type="button" role="menuitemcheckbox" aria-checked={on}
                  onClick={() => { onToggle(t.id, !on); setOpen(false); }}
                  className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent">
                  <I className="size-5" style={{ color: t.color }} />
                  <span className="flex-1">{t.name}</span>
                  {on && <Check className="size-4" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
