import { useEffect, useState } from "react";
import { FileText, LayoutTemplate, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { TemplateMeta } from "@/lib/types";
import { BUILTIN_TEMPLATES } from "./templates";

const BG: Record<string, string> = { grid: "kariert", lines: "liniert", dots: "punktiert", blank: "leer" };

/** Auswahl einer Seitenvorlage beim Anlegen eines Blatts. */
export function TemplateDialog({ open, onOpenChange, onPick }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (templateId: string) => void;
}) {
  const [own, setOwn] = useState<TemplateMeta[]>([]);
  useEffect(() => {
    if (open) api.listTemplates().then(setOwn, console.error);
  }, [open]);

  const pick = (id: string) => {
    onOpenChange(false);
    onPick(id);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Blatt aus Vorlage</DialogTitle>
          <DialogDescription>Vorlagen legen Format, Hintergrund und Grundstruktur fest.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Vorlagen">
          {BUILTIN_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => pick(t.id)}
                className="flex min-h-16 w-full items-start gap-3 rounded-md border p-3 text-left hover:bg-accent">
                <LayoutTemplate className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span><span className="block font-medium">{t.name}</span><span className="text-sm text-muted-foreground">{t.description}</span></span>
              </button>
            </li>
          ))}
        </ul>
        {own.length > 0 && (
          <>
            <h3 className="mt-2 font-medium">Eigene Vorlagen</h3>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Eigene Vorlagen">
              {own.map((t) => (
                <li key={t.id} className="flex items-center gap-1 rounded-md border">
                  <button type="button" onClick={() => pick(t.id)} className="flex min-h-16 flex-1 items-start gap-3 p-3 text-left hover:bg-accent">
                    <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{t.name}</span>
                      <span className="text-sm text-muted-foreground">{t.mode === "a4" ? "DIN A4" : "Endlos"}, {BG[t.background]} · {t.elementCount} Elemente</span>
                    </span>
                  </button>
                  <Button variant="ghost" size="icon" aria-label={`Vorlage ${t.name} löschen`}
                    onClick={() => void api.deleteTemplate(t.id).then(() => setOwn((o) => o.filter((x) => x.id !== t.id)))}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Legt ein Blatt aus einer Vorlage an (eingebaut oder eigen). */
export async function createFromTemplate(sectionId: string, parentPageId: string | null, templateId: string) {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
  if (!builtin) return api.createPageFromTemplate(sectionId, parentPageId, templateId, "");
  const title = builtin.id === "builtin:blank" ? "" : builtin.name;
  let page = await api.createPage(sectionId, parentPageId, title);
  if (Object.keys(builtin.setup).length) page = await api.updatePage(page.id, builtin.setup);
  const els = builtin.build?.(page.id) ?? [];
  if (els.length) await api.saveElements(page.id, els, []);
  return page;
}
