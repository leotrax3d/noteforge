import { create } from "zustand";

export type Route =
  | { view: "home" }
  /** `focus`: Element, auf das nach dem Laden zentriert wird (Tag-Übersicht, Suche). */
  | { view: "subject"; subjectId: string; pageId: string | null; focus?: string }
  | { view: "search"; query?: string }
  | { view: "tags"; tagId?: string }
  | { view: "calendar"; date?: number }
  | { view: "pen-test" };

interface NavState {
  route: Route;
  /** Vorherige Route für „Zurück“ aus Suche/Tags. */
  back: Route | null;
  go: (r: Route) => void;
}

export const useNav = create<NavState>((set, get) => ({
  route: { view: "home" },
  back: null,
  go: (route) => {
    const cur = get().route;
    const overlay = (r: Route) => r.view === "search" || r.view === "tags";
    set({ route, back: overlay(route) && !overlay(cur) ? cur : overlay(route) ? get().back : null });
  },
}));
