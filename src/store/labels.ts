// Alt blendet die Beschriftungen der Leisten ein bzw. wieder aus.
import { create } from "zustand";

export const useLabels = create<{ on: boolean; toggle: () => void }>((set) => ({ on: false, toggle: () => set((s) => ({ on: !s.on })) }));

let clean = false;
window.addEventListener("keydown", (e) => { clean = e.key === "Alt" && !e.repeat ? true : e.key === "Alt" ? clean : false; }, true);
window.addEventListener("keyup", (e) => {
  if (e.key === "Alt" && clean) { e.preventDefault(); useLabels.getState().toggle(); }
  clean = false;
}, true);
window.addEventListener("pointerdown", () => { clean = false; }, true);
