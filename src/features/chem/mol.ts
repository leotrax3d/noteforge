// Strukturformel (SPEC §4.4): Molekülmodell des Editors, Wertigkeit, OpenChemLib-Anbindung (Summenformel, SMILES, Molfile, 2D-Layout).
import * as OCL from "openchemlib";

export interface Atom { id: number; el: string; x: number; y: number }
export interface Bond { a: number; b: number; order: 1 | 2 | 3 }
export interface Mol { atoms: Atom[]; bonds: Bond[]; next: number }
export type MolView = "full" | "condensed" | "skeletal";
/** Im Blatt gespeichert: Molfile + gewählte Darstellung (bleibt editierbar). */
export interface MolData { molfile: string; view: MolView }

export const VIEW_LABELS: Record<MolView, string> = {
  full: "Ausführliche Strukturformel",
  condensed: "Halbstrukturformel",
  skeletal: "Skelettformel",
};

export const ELEMENTS = ["C", "H", "O", "N", "S", "Cl", "Br", "I", "F", "P", "B", "Si"] as const;
const NAMES: Record<string, string> = {
  C: "Kohlenstoff", H: "Wasserstoff", O: "Sauerstoff", N: "Stickstoff", S: "Schwefel", Cl: "Chlor", Br: "Brom",
  I: "Iod", F: "Fluor", P: "Phosphor", B: "Bor", Si: "Silicium",
};
/** Übliche Wertigkeit (für implizite H) und höchste erlaubte. */
const VALENCE: Record<string, [number, number]> = {
  C: [4, 4], H: [1, 1], O: [2, 2], N: [3, 3], S: [2, 6], Cl: [1, 1], Br: [1, 1], I: [1, 1], F: [1, 1], P: [3, 5], B: [3, 3], Si: [4, 4],
};

/** Bindungslänge im Editor-Modell (Einheiten). */
export const BOND = 1;

export const emptyMol = (): Mol => ({ atoms: [], bonds: [], next: 1 });

export function bondSum(m: Mol, id: number) {
  let s = 0;
  for (const b of m.bonds) if (b.a === id || b.b === id) s += b.order;
  return s;
}

export function neighbors(m: Mol, id: number): number[] {
  return m.bonds.flatMap((b) => (b.a === id ? [b.b] : b.b === id ? [b.a] : []));
}

/** Implizite H nach Wertigkeit (S/P: kleinste passende Wertigkeitsstufe). */
export function implicitH(m: Mol, a: Atom) {
  if (a.el === "H") return 0;
  const s = bondSum(m, a.id);
  const [v] = VALENCE[a.el] ?? [0, 0];
  if (s <= v) return v - s;
  if (a.el === "S") return s <= 4 ? 4 - s : Math.max(0, 6 - s);
  if (a.el === "P") return Math.max(0, 5 - s);
  return 0;
}

/** Valenzfehler je Atom-ID: deutscher Hinweistext. */
export function valenceErrors(m: Mol): Map<number, string> {
  const r = new Map<number, string>();
  for (const a of m.atoms) {
    const s = bondSum(m, a.id), max = VALENCE[a.el]?.[1] ?? 8;
    if (s > max) r.set(a.id, `${NAMES[a.el] ?? a.el}: ${s} Bindungen, erlaubt ${max === 1 ? "ist 1" : `sind höchstens ${max}`}`);
  }
  return r;
}

export function toOCL(m: Mol): OCL.Molecule {
  const o = new OCL.Molecule(m.atoms.length, m.bonds.length);
  const idx = new Map<number, number>();
  for (const a of m.atoms) {
    const i = o.addAtom(OCL.Molecule.getAtomicNoFromLabel(a.el));
    o.setAtomX(i, a.x * 1.5);
    o.setAtomY(i, a.y * 1.5);
    idx.set(a.id, i);
  }
  for (const b of m.bonds) o.setBondOrder(o.addBond(idx.get(b.a)!, idx.get(b.b)!), b.order);
  o.ensureHelperArrays(OCL.Molecule.cHelperRings);
  return o;
}

export function fromOCL(o: OCL.Molecule): Mol {
  o.ensureHelperArrays(OCL.Molecule.cHelperNeighbours);
  const atoms: Atom[] = [];
  for (let i = 0; i < o.getAllAtoms(); i++) atoms.push({ id: i + 1, el: o.getAtomLabel(i), x: o.getAtomX(i), y: o.getAtomY(i) });
  const bonds: Bond[] = [];
  for (let i = 0; i < o.getAllBonds(); i++) {
    bonds.push({ a: o.getBondAtom(0, i) + 1, b: o.getBondAtom(1, i) + 1, order: Math.min(3, Math.max(1, o.getBondOrder(i))) as 1 | 2 | 3 });
  }
  const m: Mol = { atoms, bonds, next: atoms.length + 1 };
  // Explizite H aus fremden Molfiles in implizite umwandeln (wird je Darstellung neu ergänzt)
  const hs = new Set(atoms.filter((a) => a.el === "H" && neighbors(m, a.id).length === 1 && atoms.length > 2).map((a) => a.id));
  m.atoms = atoms.filter((a) => !hs.has(a.id));
  m.bonds = bonds.filter((b) => !hs.has(b.a) && !hs.has(b.b));
  return normalize(m);
}

/** Auf Bindungslänge 1 skalieren und Mitte nach (0,0). */
export function normalize(m: Mol): Mol {
  if (!m.atoms.length) return m;
  const lens = m.bonds.map((b) => {
    const p = m.atoms.find((a) => a.id === b.a)!, q = m.atoms.find((a) => a.id === b.b)!;
    return Math.hypot(p.x - q.x, p.y - q.y);
  }).filter((l) => l > 1e-6).sort((a, b) => a - b);
  const k = lens.length ? BOND / lens[lens.length >> 1] : 1;
  const cx = m.atoms.reduce((s, a) => s + a.x, 0) / m.atoms.length, cy = m.atoms.reduce((s, a) => s + a.y, 0) / m.atoms.length;
  return { ...m, atoms: m.atoms.map((a) => ({ ...a, x: (a.x - cx) * k, y: (a.y - cy) * k })) };
}

export function toMolfile(m: Mol) {
  return toOCL(m).toMolfile();
}

export function fromMolfile(s: string): Mol {
  return fromOCL(OCL.Molecule.fromMolfile(s));
}

/** 2D-Layout neu berechnen (OpenChemLib). */
export function relayout(m: Mol): Mol {
  if (m.atoms.length < 2) return m;
  const o = toOCL(m);
  o.inventCoordinates();
  const r = fromOCL(o);
  return { ...r, atoms: r.atoms.map((a) => ({ ...a, y: -a.y })) };
}

export interface MolInfo { formula: string; mass: number; smiles: string }
export function molInfo(m: Mol): MolInfo | null {
  if (!m.atoms.length) return null;
  try {
    const o = toOCL(m);
    const f = o.getMolecularFormula();
    return { formula: f.formula, mass: f.relativeWeight, smiles: o.toSmiles() };
  } catch {
    return null;
  }
}

/** „C2H6O“ → mit tiefgestellten Ziffern. */
export function subscript(s: string) {
  return s.replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[+d]);
}

// ---------------- Bearbeiten ----------------

export function addAtom(m: Mol, el: string, x: number, y: number): [Mol, number] {
  const id = m.next;
  return [{ ...m, atoms: [...m.atoms, { id, el, x, y }], next: id + 1 }, id];
}

export function addBond(m: Mol, a: number, b: number, order: 1 | 2 | 3 = 1): Mol {
  if (a === b || m.bonds.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) return m;
  return { ...m, bonds: [...m.bonds, { a, b, order }] };
}

export function removeAtom(m: Mol, id: number): Mol {
  return { ...m, atoms: m.atoms.filter((a) => a.id !== id), bonds: m.bonds.filter((b) => b.a !== id && b.b !== id) };
}

export function removeBond(m: Mol, i: number): Mol {
  const bonds = m.bonds.filter((_, j) => j !== i);
  const used = new Set(bonds.flatMap((b) => [b.a, b.b]));
  const gone = m.bonds[i];
  // dadurch allein stehende Atome mit entfernen (außer es bleibt sonst nichts)
  const atoms = m.atoms.filter((a) => used.has(a.id) || (a.id !== gone.a && a.id !== gone.b) || bonds.length === 0 && a.id === gone.a);
  return { ...m, atoms, bonds };
}

export function cycleBond(m: Mol, i: number): Mol {
  return { ...m, bonds: m.bonds.map((b, j) => (j === i ? { ...b, order: ((b.order % 3) + 1) as 1 | 2 | 3 } : b)) };
}

export function setElement(m: Mol, id: number, el: string): Mol {
  return { ...m, atoms: m.atoms.map((a) => (a.id === id ? { ...a, el } : a)) };
}

const ang = (a: Atom, b: Atom) => Math.atan2(b.y - a.y, b.x - a.x);
const norm = (t: number) => Math.atan2(Math.sin(t), Math.cos(t));

/**
 * Richtung für die nächste Bindung an `id`: am Pointer `want` orientiert, auf 30°-Raster (bzw. 90° im Modus „voll“),
 * mit 120°-Zickzack zur vorherigen Bindung und Abstand zu vorhandenen Bindungen.
 */
export function snapDir(m: Mol, id: number, want: number, ortho: boolean): number {
  const a = m.atoms.find((x) => x.id === id)!;
  const used = neighbors(m, id).map((n) => ang(a, m.atoms.find((x) => x.id === n)!));
  const step = ortho ? Math.PI / 2 : Math.PI / 6;
  let cands: number[] = [];
  if (!ortho && used.length === 1) cands = [used[0] + (2 * Math.PI) / 3, used[0] - (2 * Math.PI) / 3];
  else if (!ortho && used.length === 0) cands = Array.from({ length: 6 }, (_, i) => Math.PI / 6 + (i * Math.PI) / 3);
  else cands = Array.from({ length: Math.round((2 * Math.PI) / step) }, (_, i) => i * step);
  const free = cands.filter((c) => used.every((u) => Math.abs(norm(c - u)) > (ortho ? 0.5 : 0.7)));
  const pool = free.length ? free : cands;
  return pool.reduce((best, c) => (Math.abs(norm(c - want)) < Math.abs(norm(best - want)) ? c : best), pool[0]);
}

/** Freieste Richtung an einem Atom (zum Anhängen von Gruppen). */
export function freeDir(m: Mol, id: number, ortho: boolean): number {
  const a = m.atoms.find((x) => x.id === id)!;
  const used = neighbors(m, id).map((n) => ang(a, m.atoms.find((x) => x.id === n)!));
  if (!used.length) return 0;
  const away = Math.atan2(-used.reduce((s, u) => s + Math.sin(u), 0), -used.reduce((s, u) => s + Math.cos(u), 0));
  return snapDir(m, id, used.length === 1 ? used[0] + Math.PI : away, ortho);
}

export function atomNear(m: Mol, x: number, y: number, tol: number): Atom | null {
  let best: Atom | null = null, bd = tol;
  for (const a of m.atoms) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

export function bondNear(m: Mol, x: number, y: number, tol: number): number {
  let best = -1, bd = tol;
  m.bonds.forEach((b, i) => {
    const p = m.atoms.find((a) => a.id === b.a)!, q = m.atoms.find((a) => a.id === b.b)!;
    const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / l2));
    const d = Math.hypot(p.x + t * dx - x, p.y + t * dy - y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** Neues Atom in Richtung `dir` an `from` (oder an vorhandenes nahes Atom anschließen → Ring). Liefert das Endatom. */
export function grow(m: Mol, from: number, dir: number, el = "C", order: 1 | 2 | 3 = 1): [Mol, number] {
  const a = m.atoms.find((x) => x.id === from)!;
  const x = a.x + Math.cos(dir) * BOND, y = a.y + Math.sin(dir) * BOND;
  const hit = atomNear(m, x, y, 0.35);
  if (hit && hit.id !== from) return [addBond(m, from, hit.id, order), hit.id];
  const [m2, id] = addAtom(m, el, x, y);
  return [addBond(m2, from, id, order), id];
}

export type Group = "OH" | "CHO" | "CO" | "COOH" | "COO" | "NH2" | "F" | "Cl" | "Br" | "I" | "benzene";
export const GROUPS: { id: Group; label: string; hint: string }[] = [
  { id: "OH", label: "–OH", hint: "Hydroxygruppe (Alkohol)" },
  { id: "CHO", label: "–CHO", hint: "Aldehydgruppe" },
  { id: "CO", label: "–CO–", hint: "Carbonylgruppe (Keton)" },
  { id: "COOH", label: "–COOH", hint: "Carboxygruppe (Säure)" },
  { id: "COO", label: "–COO–", hint: "Estergruppe" },
  { id: "NH2", label: "–NH₂", hint: "Aminogruppe" },
  { id: "F", label: "–F", hint: "Fluor" },
  { id: "Cl", label: "–Cl", hint: "Chlor" },
  { id: "Br", label: "–Br", hint: "Brom" },
  { id: "I", label: "–I", hint: "Iod" },
  { id: "benzene", label: "Benzolring", hint: "Phenylring" },
];

/** Gruppe an Atom `at` anhängen (oder neu beginnen). Liefert das Atom, an dem weitergezeichnet wird. */
export function attachGroup(m0: Mol, at: number | null, g: Group, ortho: boolean): [Mol, number] {
  let m = m0, anchor = at;
  if (anchor == null || !m.atoms.some((a) => a.id === anchor)) {
    if (g === "benzene") {
      [m, anchor] = addAtom(m, "C", m.atoms.length ? Math.max(...m.atoms.map((a) => a.x)) + 2 : 0, 0);
      return ring(m, anchor, Math.PI, ortho);
    }
    [m, anchor] = addAtom(m, "C", m.atoms.length ? Math.max(...m.atoms.map((a) => a.x)) + 2 : 0, 0);
  }
  const d = freeDir(m, anchor, ortho);
  const side = ortho ? Math.PI / 2 : Math.PI / 3;
  const branch = (from: number, base: number, el: string, order: 1 | 2): [Mol, number] => {
    const a = m.atoms.find((x) => x.id === from)!;
    const dir = ortho ? snapDir(m, from, base, true) : base;
    const [m2, id] = addAtom(m, el, a.x + Math.cos(dir) * BOND, a.y + Math.sin(dir) * BOND);
    return [addBond(m2, from, id, order), id];
  };
  let c: number, o: number; // eslint-disable-line prefer-const
  switch (g) {
    case "OH": case "NH2": case "F": case "Cl": case "Br": case "I":
      [m] = grow(m, anchor, d, g === "OH" ? "O" : g === "NH2" ? "N" : g);
      return [m, anchor];
    case "CHO":
      [m, c] = grow(m, anchor, d);
      [m] = branch(c, d - side, "O", 2);
      return [m, anchor];
    case "CO":
      [m, c] = grow(m, anchor, d);
      [m] = branch(c, d - side, "O", 2);
      return [m, c];
    case "COOH":
      [m, c] = grow(m, anchor, d);
      [m] = branch(c, d - side, "O", 2);
      [m] = branch(c, d + side, "O", 1);
      return [m, anchor];
    case "COO":
      [m, c] = grow(m, anchor, d);
      [m] = branch(c, d - side, "O", 2);
      [m, o] = branch(c, d + side, "O", 1);
      return [m, o];
    case "benzene": {
      [m, c] = grow(m, anchor, d);
      return ring(m, c, d + Math.PI, ortho);
    }
  }
}

/** Sechsring ab Atom `start`, das über Richtung `back` mit dem Rest verbunden ist; abwechselnd Doppelbindungen. */
function ring(m0: Mol, start: number, back: number, _ortho: boolean): [Mol, number] {
  let m = m0;
  const s = m.atoms.find((a) => a.id === start)!;
  const r = BOND; // Sechseck: Umkreisradius = Kantenlänge
  const cx = s.x - Math.cos(back) * r, cy = s.y - Math.sin(back) * r;
  const ids = [start];
  for (let i = 1; i < 6; i++) {
    const t = back + (i * Math.PI) / 3;
    let id: number;
    [m, id] = addAtom(m, "C", cx + Math.cos(t) * r, cy + Math.sin(t) * r);
    ids.push(id);
  }
  for (let i = 0; i < 6; i++) m = addBond(m, ids[i], ids[(i + 1) % 6], i % 2 === 0 ? 2 : 1);
  return [m, start];
}

export function hasRing(m: Mol) {
  // Graph mit Kreis ⇔ Kanten ≥ Knoten − Komponenten + 1
  const parent = new Map(m.atoms.map((a) => [a.id, a.id]));
  const find = (x: number): number => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const b of m.bonds) {
    const p = find(b.a), q = find(b.b);
    if (p === q) return true;
    parent.set(p, q);
  }
  return false;
}
