import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { TrashItem } from "@/lib/types";

const DAY = 86_400_000;

/** Papierkorb eines Fachs: wiederherstellen oder endgültig löschen (nach 30 Tagen automatisch). */
export function TrashDialog({ open, onOpenChange, subjectId, onChanged }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  onChanged: (restoredId?: string) => void;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api.listTrash(subjectId).then(setItems, (e) => setError(String(e)));
  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subjectId]);

  const run = async (f: () => Promise<unknown>, restored?: string) => {
    try {
      await f();
      setError(null);
      await reload();
      onChanged(restored);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Papierkorb</DialogTitle>
          <DialogDescription>Gelöschte Blätter bleiben 30 Tage erhalten.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">Der Papierkorb ist leer.</p>}
        <ul className="flex flex-col gap-1" aria-label="Gelöschte Blätter">
          {items?.map((t) => {
            const left = Math.max(0, Math.ceil((t.deletedAt + 30 * DAY - Date.now()) / DAY));
            return (
              <li key={t.page.id} className="flex items-center gap-1 rounded-md border p-1 pl-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.page.title || "Unbenanntes Blatt"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.sectionName} · gelöscht {new Date(t.deletedAt).toLocaleString("de-DE")}
                    {t.childCount > 0 && ` · ${t.childCount} Unterseite${t.childCount === 1 ? "" : "n"}`} · noch {left} Tag{left === 1 ? "" : "e"}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => void run(() => api.restorePage(t.page.id), t.page.id)}>
                  <RotateCcw /> Wiederherstellen
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive" aria-label={`${t.page.title || "Blatt"} endgültig löschen`}
                  onClick={() => void run(() => api.purgePage(t.page.id))}>
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="destructive" disabled={!items?.length} onClick={() => void run(() => api.emptyTrash(subjectId))}>
            <Trash2 /> Papierkorb leeren
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
