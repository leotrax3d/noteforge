import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Kontextmenü (Rechtsklick/langes Drücken) öffnen, nachdem die auslösende Zeigeraktion fertig ist –
 * sonst schließt das Menü sofort wieder (Radix wertet das Loslassen als Klick außerhalb).
 */
export function openSoon(set: (v: boolean) => void) {
  window.setTimeout(() => set(true), 60);
}
