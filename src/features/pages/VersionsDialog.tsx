import { useEffect, useState } from "react";
import { History, RotateCcw, Save, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { VersionMeta } from "@/lib/types";

/** Seitenversionen: automatisch beim Öffnen/Verlassen, manuell speicherbar, wiederherstellbar. */
export function VersionsDialog({ open, onOpenChange, pageId, beforeAction, onRestored }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pageId: string;
  /** Ungespeicherte Änderungen vorher sichern. */
  beforeAction: () => Promise<void>;
  onRestored: () => void;
}) {
  const [items, setItems] = useState<VersionMeta[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api.listVersions(pageId).then(setItems, (e) => setError(String(e)));
  useEffect(() => {
    if (open) {
      setConfirm(null);
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  const run = async (f: () => Promise<unknown>) => {
    try {
      await beforeAction();
      await f();
      setError(null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Seitenversionen</DialogTitle>
          <DialogDescription>
            Beim Öffnen und Verlassen eines geänderten Blatts wird automatisch eine Version angelegt (höchstens alle 10 Minuten, bis zu 50).
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Versionen.</p>}
        <ul className="flex flex-col gap-1" aria-label="Versionen">
          {items?.map((v) => (
            <li key={v.id} className="flex items-center gap-1 rounded-md border p-1 pl-3">
              <History className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 pl-1">
                <span className="block text-sm font-medium">{new Date(v.createdAt).toLocaleString("de-DE")}</span>
                <span className="block text-xs text-muted-foreground">{v.label || "Automatisch"} · {v.elementCount} Elemente</span>
              </span>
              {confirm === v.id ? (
                <Button variant="destructive" onClick={() => void run(async () => { await api.restoreVersion(v.id); onRestored(); onOpenChange(false); })}>
                  Ja, wiederherstellen
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirm(v.id)}><RotateCcw /> Wiederherstellen</Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Version löschen" onClick={() => void run(() => api.deleteVersion(v.id))}><Trash2 /></Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => void run(() => api.createVersion(pageId, "Manuell gespeichert"))}><Save /> Aktuellen Stand sichern</Button>
          <Button onClick={() => onOpenChange(false)}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
