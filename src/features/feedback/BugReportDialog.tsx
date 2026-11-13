import { useEffect, useState } from "react";
import { Bug, CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BUG_MAX, submitBugReport, useBugReport, validateBugReport } from "./bug-report";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "ok"; msg: string } | { kind: "error"; msg: string };

/** Global eingehängt; öffnen über `useBugReport.getState().show()` (fotografiert vorher die Ansicht). */
export function GlobalBugReportDialog() {
  const { open, shot, close } = useBugReport();
  return <BugReportDialog open={open} shot={shot} onOpenChange={(o) => { if (!o) close(); }} />;
}

/** „Bug melden“: Beschreibung eingeben, optional Bildschirmfoto anhängen, absenden, Erfolg/Fehler anzeigen. */
export function BugReportDialog({ open, onOpenChange, shot = null }: { open: boolean; onOpenChange: (o: boolean) => void; shot?: string | null }) {
  const [attach, setAttach] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setAttach(false); setState((s) => (s.kind === "ok" ? { kind: "idle" } : s)); setTouched(false); } }, [open]);

  const invalid = validateBugReport(text);
  const sending = state.kind === "sending";
  const len = [...text.trim()].length;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || sending) return;
    setState({ kind: "sending" });
    try {
      const msg = await submitBugReport(text, attach ? shot : null);
      setState({ kind: "ok", msg });
      setText("");
    } catch (err) {
      setState({ kind: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bug className="size-5 text-primary" aria-hidden /> Bug melden</DialogTitle>
          <DialogDescription>Was ist passiert, und was hast du davor gemacht? Version und Betriebssystem werden automatisch mitgeschickt.</DialogDescription>
        </DialogHeader>
        {state.kind === "ok" ? (
          <div role="status" data-testid="bug-ok" className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <p className="font-medium">{state.msg}</p>
          </div>
        ) : (
          <form id="bug-form" onSubmit={(e) => void send(e)} className="grid gap-2">
            <Label htmlFor="bug-text" className="sr-only">Fehlerbeschreibung</Label>
            <textarea id="bug-text" rows={7} autoFocus value={text} maxLength={BUG_MAX + 200} disabled={sending}
              placeholder="z. B. Beim Öffnen des Kalenders bleibt die Seite weiß, nachdem ich ein Fach gelöscht habe."
              aria-invalid={touched && !!invalid} aria-describedby="bug-hint"
              onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)}
              className="min-h-36 resize-y rounded-md border bg-background p-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive" />
            <div id="bug-hint" className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className={cn(touched && invalid && "text-destructive")}>{touched && invalid ? invalid : "Keine Passwörter oder persönlichen Daten eintragen."}</span>
              <span className={cn("tabular-nums", len > BUG_MAX && "text-destructive")}>{len}/{BUG_MAX}</span>
            </div>
            {shot && (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-2 text-sm">
                <input type="checkbox" className="size-5 shrink-0" checked={attach} disabled={sending} onChange={(e) => setAttach(e.target.checked)} data-testid="bug-attach" />
                <span className="flex-1">Bildschirmfoto anhängen<span className="block text-xs text-muted-foreground">Zeigt die Ansicht vor dem Öffnen dieses Fensters – prüfe, ob private Notizen zu sehen sind.</span></span>
                <img src={shot} alt="Vorschau des Bildschirmfotos" className="h-16 w-24 shrink-0 rounded border object-cover object-top" />
              </label>
            )}
            {state.kind === "error" && <p role="alert" data-testid="bug-error" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{state.msg}</p>}
          </form>
        )}
        <DialogFooter>
          {state.kind === "ok" ? (
            <Button type="button" onClick={() => onOpenChange(false)}>Schließen</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={sending} onClick={() => onOpenChange(false)}>Abbrechen</Button>
              <Button type="submit" form="bug-form" disabled={sending || (touched && !!invalid)}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />} {sending ? "Wird gesendet …" : "Absenden"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
