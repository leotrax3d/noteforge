import {
  Atom, BookOpen, Brain, Calculator, Church, Code, Dumbbell, FlaskConical, Globe, Landmark,
  Languages, Leaf, Music, Palette, PenTool, Scale, type LucideIcon,
} from "lucide-react";

export const SUBJECT_COLORS = [
  { value: "#2563eb", label: "Blau" },
  { value: "#0891b2", label: "Türkis" },
  { value: "#16a34a", label: "Grün" },
  { value: "#65a30d", label: "Hellgrün" },
  { value: "#ca8a04", label: "Gelb" },
  { value: "#ea580c", label: "Orange" },
  { value: "#dc2626", label: "Rot" },
  { value: "#db2777", label: "Pink" },
  { value: "#9333ea", label: "Lila" },
  { value: "#475569", label: "Grau" },
] as const;

export const SUBJECT_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  calculator: { icon: Calculator, label: "Mathematik" },
  "book-open": { icon: BookOpen, label: "Buch" },
  languages: { icon: Languages, label: "Sprachen" },
  "flask-conical": { icon: FlaskConical, label: "Chemie" },
  atom: { icon: Atom, label: "Physik" },
  leaf: { icon: Leaf, label: "Biologie" },
  globe: { icon: Globe, label: "Geografie" },
  landmark: { icon: Landmark, label: "Geschichte" },
  scale: { icon: Scale, label: "Gemeinschaftskunde" },
  church: { icon: Church, label: "Religion" },
  brain: { icon: Brain, label: "Ethik" },
  palette: { icon: Palette, label: "Kunst" },
  music: { icon: Music, label: "Musik" },
  dumbbell: { icon: Dumbbell, label: "Sport" },
  code: { icon: Code, label: "Informatik" },
  "pen-tool": { icon: PenTool, label: "Sonstiges" },
};

export function subjectIcon(key: string): LucideIcon {
  return (SUBJECT_ICONS[key] ?? SUBJECT_ICONS["pen-tool"]).icon;
}
