import { create } from "zustand";

export type Route =
  | { view: "home" }
  | { view: "subject"; subjectId: string; pageId: string | null }
  | { view: "pen-test" };

interface NavState {
  route: Route;
  go: (r: Route) => void;
}

export const useNav = create<NavState>((set) => ({
  route: { view: "home" },
  go: (route) => set({ route }),
}));
