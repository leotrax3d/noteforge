import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = "noteforge-theme";
const ThemeContext = createContext<ThemeState | null>(null);
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignorieren */
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    // Während des Wechsels keine Übergänge: sonst bleiben in WebView2 einzelne Elemente in alten Farben stehen
    const st = document.createElement("style");
    st.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(st);
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    void window.getComputedStyle(document.body).color; // Neuberechnung erzwingen
    const id = requestAnimationFrame(() => requestAnimationFrame(() => st.remove()));
    return () => { cancelAnimationFrame(id); st.remove(); };
  }, [resolved]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignorieren */
    }
  };

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme muss innerhalb von ThemeProvider verwendet werden");
  return ctx;
}
