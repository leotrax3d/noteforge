// Helfer „Spitz“: beim ersten Benutzen eines Werkzeugs ein kurzer, abschaltbarer Tipp.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/common/Logo";
import { useSetup } from "@/store/setup";
import { useTools } from "./tool-store";

export const HINTS: Record<string, string> = {
  fountain: "Der Füller reagiert auf Druck. Stift am Strichende kurz halten macht aus einer Skizze eine saubere Form.",
  ballpoint: "Der Kugelschreiber schreibt immer gleich breit – ideal für kleine Schrift und Formeln.",
  pencil: "Der Bleistift hat eine leichte Textur. Mit dem Radierende des Stifts radierst du ohne Werkzeugwechsel.",
  highlighter: "Der Textmarker liegt immer unter der Schrift. Gerade Linien: Lineal einblenden (Hilfsmittel).",
  eraser: "Tippe den Radierer nochmal an, um zwischen ganzen Strichen und teilweisem Radieren zu wechseln.",
  lasso: "Umkreise Striche oder Bilder. Die Auswahl kannst du mit jedem Werkzeug direkt ziehen, Ecken skalieren, oben drehen.",
  pan: "Mit einem Finger verschieben, mit zwei zoomen. Zwei Finger kurz tippen = Rückgängig.",
  text: "Tippe irgendwo hin für ein Textfeld – auf karierten und linierten Blättern rastet die Zeile ein (Alt = frei). Doppelklick geht mit jedem Werkzeug.",
};

export function SpitzHint() {
  const tool = useTools((s) => s.tool);
  const pen = useTools((s) => s.pen);
  const { spitz, seenHints, seeHint, set } = useSetup();
  const [hint, setHint] = useState<string | null>(null);
  const key = tool === "pen" ? pen : tool;

  useEffect(() => {
    if (!spitz || seenHints.includes(key) || !HINTS[key]) return;
    // nicht beim ersten Laden des Blatts mit dem Standardstift sofort aufpoppen
    const t = window.setTimeout(() => setHint(key), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, spitz]);

  if (!hint || !spitz) return null;
  const close = () => { seeHint(hint); setHint(null); };
  return (
    <div role="status" aria-live="polite" data-testid="spitz-hint"
      className="pointer-events-auto absolute right-4 bottom-4 z-30 flex max-w-sm items-start gap-3 rounded-2xl border bg-card p-3 shadow-xl">
      <Logo size={36} className="shrink-0" />
      <div className="grid gap-2 text-sm">
        <p><b>Spitz:</b> {HINTS[hint]}</p>
        <div className="flex gap-2">
          <Button size="sm" className="h-11" onClick={close}>Verstanden</Button>
          <Button size="sm" variant="ghost" className="h-11" onClick={() => { close(); set({ spitz: false }); }}>Spitz ausschalten</Button>
        </div>
      </div>
      <button type="button" aria-label="Tipp schließen" onClick={close} className="-m-1 flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent"><X className="size-4" /></button>
    </div>
  );
}
