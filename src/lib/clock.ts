// Netzzeit (SPEC §8.1): Das Backend misst die Abweichung der Geräteuhr über den HTTP-Date-Kopf von
// Nextcloud/WebUntis (alle 5 min und bei jedem Zugriff) und merkt sie sich für offline. Alle
// zeitabhängigen Anzeigen (aktive Stunde, Pausen, Hinweise) nutzen `now()` statt `Date.now()`.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { inTauri } from "./api";

export const useClock = create<{ offsetMs: number; measuredAt: number | null }>(() => ({ offsetMs: 0, measuredAt: null }));

/** Korrigierte Zeit (ms). */
export const now = () => Date.now() + useClock.getState().offsetMs;

let started = false;
/** Abweichung vom Backend holen (minütlich; das Backend misst selbst alle 5 min nach). */
export function startClock() {
  if (started || !inTauri) return;
  started = true;
  const pull = () => invoke<{ offsetMs: number; measuredAt: number | null }>("clock_state").then((s) => useClock.setState(s), () => {});
  void pull();
  window.setInterval(pull, 60_000);
}

/** Aktuelle Netzzeit als State, im Takt `stepMs` (Standard: zum Minutenwechsel). */
export function useNow(stepMs = 60_000): number {
  const off = useClock((s) => s.offsetMs);
  const [t, setT] = useState(now);
  useEffect(() => {
    setT(now());
    let timer = 0;
    const tick = () => {
      setT(now());
      // Am Minutenwechsel ausrichten, damit Pausen/Stunden pünktlich umschalten.
      timer = window.setTimeout(tick, stepMs - (now() % stepMs) + 50);
    };
    timer = window.setTimeout(tick, stepMs - (now() % stepMs) + 50);
    return () => window.clearTimeout(timer);
  }, [stepMs, off]);
  return t;
}
