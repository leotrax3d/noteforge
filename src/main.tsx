import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * Fenster erst nach dem ersten fertigen Frame zeigen (startet mit `visible: false`).
 * Doppeltes rAF: der erste Callback läuft vor dem Zeichnen, der zweite danach.
 * Schriften abwarten (max. 300 ms), damit kein Layout-Sprung sichtbar wird.
 */
async function reveal() {
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 300))]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const dark = document.documentElement.classList.contains("dark");
  await w.setBackgroundColor(dark ? "#0a0a0a" : "#ffffff").catch(() => {});
  await w.show();
}
void reveal().catch(console.error);
