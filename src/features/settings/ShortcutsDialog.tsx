import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUTS } from "@/lib/shortcuts";

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tastenkürzel</DialogTitle>
          <DialogDescription className="sr-only">Einzeltasten wirken nur auf dem Blatt, nicht beim Schreiben in Textfeldern.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <section key={g.title} className={g.title === "Allgemein" ? "sm:col-span-2" : undefined}>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">{g.title}</h3>
              <dl className="grid gap-1.5">
                {g.items.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3">
                    <dt className="text-sm">{s.label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {s.keys.map((k, i) => (
                        <kbd key={i} className="min-w-7 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{k}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
