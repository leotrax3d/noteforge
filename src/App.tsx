import { useEffect } from "react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { HomePage } from "@/features/home/HomePage";
import { PenTestPage } from "@/features/pen-test/PenTestPage";
import { SearchPage } from "@/features/search/SearchPage";
import { SubjectView } from "@/features/subject/SubjectView";
import { TagsPage } from "@/features/tags/TagsPage";
import { useNav } from "@/store/nav";

export default function App() {
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);

  // Strg+K / Strg+F: Suche von überall
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f")) {
        e.preventDefault();
        if (useNav.getState().route.view !== "search") go({ view: "search" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <ThemeProvider>
      {route.view === "home" && <HomePage />}
      {route.view === "subject" && <SubjectView subjectId={route.subjectId} pageId={route.pageId} focus={route.focus} />}
      {route.view === "search" && <SearchPage query={route.query} />}
      {route.view === "tags" && <TagsPage tagId={route.tagId} />}
      {route.view === "calendar" && <CalendarPage key={route.date ?? 0} date={route.date} mode={route.date ? "week" : undefined} />}
      {route.view === "pen-test" && <PenTestPage />}
    </ThemeProvider>
  );
}
