import { ThemeProvider } from "@/components/theme/theme-provider";
import { HomePage } from "@/features/home/HomePage";
import { PenTestPage } from "@/features/pen-test/PenTestPage";
import { SubjectView } from "@/features/subject/SubjectView";
import { useNav } from "@/store/nav";

export default function App() {
  const route = useNav((s) => s.route);
  return (
    <ThemeProvider>
      {route.view === "home" && <HomePage />}
      {route.view === "subject" && <SubjectView subjectId={route.subjectId} pageId={route.pageId} />}
      {route.view === "pen-test" && <PenTestPage />}
    </ThemeProvider>
  );
}
