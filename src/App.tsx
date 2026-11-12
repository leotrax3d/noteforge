import { ThemeProvider } from "@/components/theme/theme-provider";
import { PenTestPage } from "@/features/pen-test/PenTestPage";

export default function App() {
  return (
    <ThemeProvider>
      <PenTestPage />
    </ThemeProvider>
  );
}
