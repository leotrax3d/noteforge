import { create } from "zustand";
import {
  AlertTriangle, Bookmark, CircleHelp, Flag, GraduationCap, Heart, Lightbulb, Mic, SquareCheck, Star,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Tag } from "@/lib/types";

export const TAG_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  "square-check": { icon: SquareCheck, label: "Aufgabe" },
  star: { icon: Star, label: "Stern" },
  "circle-help": { icon: CircleHelp, label: "Frage" },
  "graduation-cap": { icon: GraduationCap, label: "Lernen" },
  lightbulb: { icon: Lightbulb, label: "Idee" },
  flag: { icon: Flag, label: "Flagge" },
  bookmark: { icon: Bookmark, label: "Lesezeichen" },
  "alert-triangle": { icon: AlertTriangle, label: "Achtung" },
  heart: { icon: Heart, label: "Herz" },
  mic: { icon: Mic, label: "Vortrag" },
};

export const tagIcon = (key: string): LucideIcon => (TAG_ICONS[key] ?? TAG_ICONS.bookmark).icon;

interface TagState {
  tags: Tag[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string, icon: string, color: string) => Promise<Tag>;
  remove: (id: string) => Promise<void>;
}

/** Tag-Katalog (klein, app-weit gecacht). */
export const useTagStore = create<TagState>((set, get) => ({
  tags: [],
  loaded: false,
  load: async () => set({ tags: await api.listTags(), loaded: true }),
  create: async (name, icon, color) => {
    const t = await api.createTag(name, icon, color);
    set({ tags: [...get().tags, t] });
    return t;
  },
  remove: async (id) => {
    await api.deleteTag(id);
    set({ tags: get().tags.filter((t) => t.id !== id) });
  },
}));
