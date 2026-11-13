import { GlobalBugReportDialog } from "@/features/feedback/BugReportDialog";
import { GlobalMappingDialog } from "@/features/settings/MappingDialog";
import { lazy, Suspense, useEffect } from "react";
import { StartupNotices } from "@/features/update/StartupNotices";
import { GlassBackdrop } from "@/components/glass/Backdrop";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { HomePage } from "@/features/home/HomePage";
import { SearchPage } from "@/features/search/SearchPage";
import { SubjectView } from "@/features/subject/SubjectView";
import { TagsPage } from "@/features/tags/TagsPage";
import { HomeworkPage } from "@/features/school/HomeworkPage";
import { GradesPage } from "@/features/school/GradesPage";
import { useNav } from "@/store/nav";
import { toggleFocus, usePrefs } from "@/store/prefs";
import { listenCloud, syncNowAndApply } from "@/lib/sync";
import { startGcalPolling } from "@/lib/gcal";
import { listenDeepLinks } from "@/lib/deep-link";
import { typing } from "@/lib/shortcuts";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { useSetup } from "@/store/setup";
import { CommandPalette } from "@/features/palette/CommandPalette";
const Onboarding = lazy(() => import("@/features/onboarding/Onboarding").then((m) => ({ default: m.Onboarding })));
import { ShortcutsDialog } from "@/features/settings/ShortcutsDialog";
import { useCalc } from "@/features/calc/calc-store";

// mathjs ist groß → Rechner erst beim ersten Öffnen laden
const CalcPanel = lazy(() => import("@/features/calc/CalcPanel").then((m) => ({ default: m.CalcPanel })));

export default function App() {
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  const setupDone = useSetup((s) => s.done);

  const dialog = usePrefs((s) => s.dialog);
  const calcOpen = useCalc((s) => s.open);
  const setDialog = usePrefs((s) => s.setDialog);

  // Hintergrund-Syncs des Backends empfangen
  useEffect(() => {
    let off: (() => void) | undefined;
    void listenCloud().then((f) => (off = f));
    return () => off?.();
  }, []);

  // Google-Kalender im Hintergrund abgleichen; noteforge://-Links öffnen
  useEffect(() => startGcalPolling(), []);
  useEffect(() => {
    let off: (() => void) | undefined;
    void listenDeepLinks().then((f) => (off = f)).catch(console.error);
    return () => off?.();
  }, []);

  // Globale Tastenkürzel (Übersicht: lib/shortcuts.ts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const p = usePrefs.getState();
      if (mod && !e.shiftKey && k === "k") p.setDialog(p.dialog === "palette" ? null : "palette");
      else if (mod && !e.shiftKey && k === "f") {
        if (useNav.getState().route.view !== "search") go({ view: "search" });
      } else if (mod && !e.shiftKey && k === ",") p.setDialog("settings");
      else if (e.key === "F1" || (e.key === "?" && !mod && !typing(e.target))) p.setDialog("shortcuts");
      else if (e.key === "F11" || (mod && e.shiftKey && k === "f")) toggleFocus();
      else if (mod && e.shiftKey && k === "p") p.setPerfOverlay(!p.perfOverlay);
      else if (mod && e.shiftKey && k === "d") p.setInkDebug(!p.inkDebug);
      else if (mod && e.shiftKey && k === "r") useCalc.getState().toggle();
      else if (mod && e.shiftKey && k === "g") useCalc.getState().openPlot(null, false);
      else if (e.altKey && k === "h") go({ view: "homework" });
      else if (e.altKey && k === "n") go({ view: "grades" });
      else if (mod && e.shiftKey && k === "s") void syncNowAndApply().catch(console.error);
      else if (e.altKey && e.key === "Home") go({ view: "home" });
      else if (e.key === "Escape" && p.focus && !p.dialog && !document.querySelector("[role=dialog]")) toggleFocus(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Fokusmodus nur auf einem Blatt
  useEffect(() => {
    if (route.view !== "subject" || !route.pageId) toggleFocus(false);
  }, [route]);

  return (
    <ThemeProvider>
      <GlassBackdrop />
      <div key={route.view} className="nf-page h-full">
      {route.view === "home" && <HomePage />}
      {route.view === "subject" && <SubjectView subjectId={route.subjectId} pageId={route.pageId} focus={route.focus} />}
      {route.view === "search" && <SearchPage query={route.query} />}
      {route.view === "tags" && <TagsPage tagId={route.tagId} />}
      {route.view === "calendar" && <CalendarPage key={route.date ?? 0} date={route.date} mode={route.date ? "week" : undefined} />}
      {route.view === "homework" && <HomeworkPage subjectId={route.subjectId} />}
      {route.view === "grades" && <GradesPage subjectId={route.subjectId} />}
      </div>
      <SettingsDialog open={dialog === "settings"} onOpenChange={(o) => setDialog(o ? "settings" : null)} />
      {calcOpen && <Suspense fallback={null}><CalcPanel /></Suspense>}
      <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={(o) => setDialog(o ? "shortcuts" : null)} />
      <StartupNotices />
      <GlobalMappingDialog />
      <GlobalBugReportDialog />
      <CommandPalette open={dialog === "palette"} onOpenChange={(o) => setDialog(o ? "palette" : null)} />
      {!setupDone && <Suspense fallback={null}><Onboarding onDone={() => go({ view: "home" })} /></Suspense>}
    </ThemeProvider>
  );
}

