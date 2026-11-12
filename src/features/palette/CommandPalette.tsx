// Befehlspalette (Strg+K): Navigation, Fächer, Werkzeuge und Aktionen per Tastatur oder Stift.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookCheck, BookOpen, Calculator, CalendarDays, Eraser, Focus, GraduationCap, Hand, Highlighter, Home, Keyboard, Lasso,
  LineChart, Monitor, Moon, PenTool, RefreshCw, Search, Settings, Sun, Tags, Type, Wand2,
} from "lucide-react";
import { MoleculeIcon } from "@/features/chem/MoleculeIcon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "@/components/theme/theme-provider";
import { api } from "@/lib/api";
import { syncNowAndApply } from "@/lib/sync";
import type { Subject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNav } from "@/store/nav";
import { toggleFocus, usePrefs } from "@/store/prefs";
import { useSetup } from "@/store/setup";
import { useCalc } from "@/features/calc/calc-store";
import { useTools } from "@/features/canvas/tool-store";

export interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  icon?: ReactNode;
  /** Zusätzliche Suchbegriffe */
  words?: string;
  run: () => void;
}

/** Alle Suchwörter müssen (als Wortanfang oder Teilwort) vorkommen; Treffer am Wortanfang zuerst. */
export function filterCommands(cmds: Command[], q: string): Command[] {
  const words = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return cmds;
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const scored = cmds
    .map((c) => {
      const hay = norm(`${c.label} ${c.group} ${c.words ?? ""}`);
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((a, w) => a + (new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay) ? 2 : 1), 0);
      return { c, score };
    })
    .filter((x): x is { c: Command; score: number } => !!x);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.c);
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const go = useNav((s) => s.go);
  const { setTheme } = useTheme();

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    void api.listSubjects().then(setSubjects).catch(() => setSubjects([]));
  }, [open]);

  const cmds = useMemo<Command[]>(() => {
    const t = useTools.getState();
    const p = usePrefs.getState();
    const tool = (id: string, label: string, icon: ReactNode, keys: string | undefined, fn: () => void): Command =>
      ({ id: `tool:${id}`, label, group: "Werkzeug", icon, keys, run: fn, words: "stift werkzeug" });
    return [
      { id: "nav:home", label: "Startseite", group: "Gehe zu", icon: <Home />, keys: "Alt+Pos1", run: () => go({ view: "home" }) },
      { id: "nav:calendar", label: "Kalender", group: "Gehe zu", icon: <CalendarDays />, run: () => go({ view: "calendar" }), words: "termine stundenplan woche" },
      { id: "nav:homework", label: "Hausaufgaben", group: "Gehe zu", icon: <BookCheck />, keys: "Alt+H", run: () => go({ view: "homework" }) },
      { id: "nav:grades", label: "Noten", group: "Gehe zu", icon: <GraduationCap />, keys: "Alt+N", run: () => go({ view: "grades" }), words: "notenrechner schnitt" },
      { id: "nav:tags", label: "Tags", group: "Gehe zu", icon: <Tags />, run: () => go({ view: "tags" }), words: "markierungen todo" },
      { id: "nav:search", label: "Suche", group: "Gehe zu", icon: <Search />, keys: "Strg+F", run: () => go({ view: "search" }), words: "finden volltext" },
      ...subjects.map((s): Command => ({
        id: `subject:${s.id}`, label: s.name, group: "Fach öffnen", icon: <BookOpen style={{ color: s.color }} />,
        run: () => go({ view: "subject", subjectId: s.id, pageId: null }), words: "fach",
      })),
      tool("fountain", "Füller", <PenTool />, "B", () => t.setPen("fountain")),
      tool("highlighter", "Textmarker", <Highlighter />, "M", () => t.setPen("highlighter")),
      tool("eraser", "Radierer", <Eraser />, "E", () => t.setTool("eraser")),
      tool("lasso", "Lasso", <Lasso />, "L", () => t.setTool("lasso")),
      tool("pan", "Verschieben", <Hand />, "H", () => t.setTool("pan")),
      tool("text", "Text", <Type />, "T", () => t.setTool("text")),
      { id: "calc", label: "Taschenrechner", group: "Aktion", icon: <Calculator />, keys: "Strg+Umschalt+R", run: () => useCalc.getState().toggle() },
      { id: "plot", label: "Funktionsplotter", group: "Aktion", icon: <LineChart />, keys: "Strg+Umschalt+G", run: () => useCalc.getState().openPlot(null, false), words: "graph funktion" },
      { id: "molecule", label: "Strukturformel", group: "Aktion", icon: <MoleculeIcon />, run: () => window.dispatchEvent(new CustomEvent("nf-molecule")), words: "chemie molekül skelettformel einfügen" },
      { id: "focus", label: "Fokusmodus", group: "Aktion", icon: <Focus />, keys: "F11", run: () => toggleFocus() },
      { id: "sync", label: "Jetzt synchronisieren", group: "Aktion", icon: <RefreshCw />, keys: "Strg+Umschalt+S", run: () => void syncNowAndApply().catch(console.error), words: "nextcloud abgleich" },
      { id: "settings", label: "Einstellungen", group: "Aktion", icon: <Settings />, keys: "Strg+,", run: () => p.setDialog("settings") },
      { id: "shortcuts", label: "Tastenkürzel", group: "Aktion", icon: <Keyboard />, keys: "F1", run: () => p.setDialog("shortcuts"), words: "hilfe" },
      { id: "setup", label: "Einrichtungsassistent starten", group: "Aktion", icon: <Wand2 />, run: () => useSetup.getState().set({ done: false, step: 0 }), words: "onboarding einrichten" },
      { id: "theme:light", label: "Design: Hell", group: "Darstellung", icon: <Sun />, run: () => setTheme("light"), words: "theme" },
      { id: "theme:dark", label: "Design: Dunkel", group: "Darstellung", icon: <Moon />, run: () => setTheme("dark"), words: "theme nacht" },
      { id: "theme:system", label: "Design: System", group: "Darstellung", icon: <Monitor />, run: () => setTheme("system"), words: "theme" },
    ];
  }, [subjects, go, setTheme]);

  const shown = useMemo(() => {
    const r = filterCommands(cmds, q);
    // Freitext → Volltextsuche anbieten
    if (q.trim()) r.push({ id: "search:q", label: `„${q.trim()}“ in Notizen suchen`, group: "Suche", icon: <Search />, run: () => go({ view: "search", query: q.trim() }) });
    return r.slice(0, 50);
  }, [cmds, q, go]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // nach dem Schließen ausführen (Fokus/Dialoge)
    window.setTimeout(c.run, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-xl" data-testid="command-palette">
        <DialogTitle className="sr-only">Befehlspalette</DialogTitle>
        <DialogDescription className="sr-only">Befehl, Fach oder Werkzeug suchen und mit Enter ausführen.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-5 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Befehl, Fach oder Werkzeug …"
            aria-label="Befehl suchen" aria-controls="palette-list" aria-activedescendant={shown[sel] ? `pc-${sel}` : undefined}
            className="h-14 flex-1 bg-transparent text-base outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(shown[sel]); }
            }} />
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" aria-label="Befehle" className="max-h-[50vh] overflow-y-auto p-1">
          {shown.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Kein Befehl gefunden.</li>}
          {shown.map((c, i) => (
            <li key={c.id} id={`pc-${i}`} role="option" aria-selected={i === sel} data-index={i}>
              <button type="button" onClick={() => run(c)} onPointerMove={() => setSel(i)}
                className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm [&_svg]:size-4", i === sel && "bg-accent")}>
                <span className="text-muted-foreground">{c.icon}</span>
                <span className="flex-1 truncate">{c.label}</span>
                <span className="text-xs text-muted-foreground">{c.group}</span>
                {c.keys && <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{c.keys}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
