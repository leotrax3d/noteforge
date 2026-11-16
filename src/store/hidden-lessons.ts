import { create } from "zustand";
import type { Lesson } from "@/lib/integrations";

/** WebUntis-Fächer/Kurse, die der Nutzer nicht belegt (z. B. Italienisch) – auf diesem Gerät gespeichert. */
export interface HiddenEntry { key: string; label: string }

const KEY = "noteforge-untis-hidden";

/** Schlüssel eines WebUntis-Fachs: Fach-ID, sonst Kurzname (für Stunden ohne ID). */
export const lessonKey = (l: Pick<Lesson, "untisSubjectId" | "subjectName">) =>
  l.untisSubjectId != null ? `id:${l.untisSubjectId}` : `name:${l.subjectName.trim().toLowerCase()}`;
export const lessonLabel = (l: Pick<Lesson, "subjectLong" | "subjectName">) => l.subjectLong || l.subjectName || "Stunde";

/** Stunden ohne ausgeblendete Fächer (leerer Platz wird dadurch zur Freistunde). */
export function visibleLessons<T extends Pick<Lesson, "untisSubjectId" | "subjectName">>(lessons: T[], hidden: readonly HiddenEntry[]): T[] {
  if (!hidden.length) return lessons;
  const set = new Set(hidden.map((h) => h.key));
  return lessons.filter((l) => !set.has(lessonKey(l)));
}

function load(): HiddenEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.key === "string").map((x) => ({ key: x.key, label: String(x.label ?? x.key) })) : [];
  } catch {
    return [];
  }
}
function save(list: HiddenEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* privat/gesperrt: nur für diese Sitzung */ }
}

export const useHiddenLessons = create<{ hidden: HiddenEntry[]; hide: (l: Lesson) => void; show: (key: string) => void }>((set, get) => ({
  hidden: load(),
  hide: (l) => {
    const key = lessonKey(l);
    if (get().hidden.some((h) => h.key === key)) return;
    const hidden = [...get().hidden, { key, label: lessonLabel(l) }].sort((a, b) => a.label.localeCompare(b.label, "de"));
    save(hidden);
    set({ hidden });
  },
  show: (key) => {
    const hidden = get().hidden.filter((h) => h.key !== key);
    save(hidden);
    set({ hidden });
  },
}));
