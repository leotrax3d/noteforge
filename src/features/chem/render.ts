// Strukturformel: SVG-Darstellungen im App-Stil (ausführlich rechtwinklig, Halbstruktur, Skelett).
import { hasRing, implicitH, neighbors, type Mol, type MolView } from "./mol";

interface Node { x: number; y: number; label: string | null }
interface Edge { p: number; q: number; order: number }
export interface MolSvg { svg: string; w: number; h: number }

const FS = 15;
const PAD = 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Breite eines Labels (Ziffern tiefgestellt, kleiner). */
function labelW(s: string) {
  let w = 0;
  for (const ch of s) w += /\d/.test(ch) ? FS * 0.48 : ch === "H" || ch === "C" || ch === "O" || ch === "N" ? FS * 0.72 : FS * 0.6;
  return w;
}

function labelSvg(s: string, x: number, y: number, color: string) {
  let parts = "", sub = false;
  for (const m of s.match(/\d+|\D+/g) ?? []) {
    const d = /\d/.test(m);
    if (d && !sub) parts += `<tspan dy="4" font-size="${FS * 0.72}">${m}</tspan>`;
    else if (!d && sub) parts += `<tspan dy="-4">${esc(m)}</tspan>`;
    else parts += d ? `<tspan font-size="${FS * 0.72}">${m}</tspan>` : esc(m);
    sub = d;
  }
  return `<text x="${x.toFixed(1)}" y="${(y + FS * 0.35).toFixed(1)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${FS}" fill="${color}">${parts}</text>`;
}

/** Linienende an einem beschrifteten Knoten kürzen (Label-Rechteck). */
function clip(n: Node, dx: number, dy: number) {
  if (!n.label) return 0;
  const hw = labelW(n.label) / 2 + 2, hh = FS * 0.55;
  const l = Math.hypot(dx, dy) || 1, ux = Math.abs(dx / l), uy = Math.abs(dy / l);
  return Math.min(ux > 1e-6 ? hw / ux : Infinity, uy > 1e-6 ? hh / uy : Infinity);
}

function emit(nodes: Node[], edges: Edge[], color: string): MolSvg {
  if (!nodes.length) return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"></svg>`, w: 40, h: 40 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const hw = n.label ? labelW(n.label) / 2 : 2, hh = n.label ? FS * 0.7 : 2;
    x0 = Math.min(x0, n.x - hw); x1 = Math.max(x1, n.x + hw); y0 = Math.min(y0, n.y - hh); y1 = Math.max(y1, n.y + hh);
  }
  const ox = PAD - x0, oy = PAD - y0, w = Math.ceil(x1 - x0 + 2 * PAD), h = Math.ceil(y1 - y0 + 2 * PAD);
  let body = "";
  for (const e of edges) {
    const p = nodes[e.p], q = nodes[e.q];
    const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const s0 = clip(p, dx, dy), s1 = clip(q, dx, dy);
    if (s0 + s1 >= l - 2) continue;
    const ax = p.x + ux * s0 + ox, ay = p.y + uy * s0 + oy, bx = q.x - ux * s1 + ox, by = q.y - uy * s1 + oy;
    const offs = e.order === 1 ? [0] : e.order === 2 ? [-2.6, 2.6] : [-4, 0, 4];
    for (const o of offs) body += `<line x1="${(ax - uy * o).toFixed(1)}" y1="${(ay + ux * o).toFixed(1)}" x2="${(bx - uy * o).toFixed(1)}" y2="${(by + ux * o).toFixed(1)}"/>`;
  }
  let text = "";
  for (const n of nodes) if (n.label) text += labelSvg(n.label, n.x + ox, n.y + oy, color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g stroke="${color}" stroke-width="1.6" stroke-linecap="round">${body}</g>${text}</svg>`;
  return { svg, w, h };
}

type Cell = { x: number; y: number };
const DIRS: Cell[] = [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
const key = (c: Cell) => `${c.x},${c.y}`;

/** Längster Weg im Baum (zweifache Breitensuche). */
function longestPath(m: Mol): number[] {
  const bfs = (s: number) => {
    const prev = new Map<number, number>([[s, -1]]), q = [s];
    let last = s;
    while (q.length) {
      const a = q.shift()!;
      last = a;
      for (const n of neighbors(m, a)) if (!prev.has(n)) { prev.set(n, a); q.push(n); }
    }
    return { last, prev };
  };
  const { last: a } = bfs(m.atoms[0].id);
  const { last: b, prev } = bfs(a);
  const path: number[] = [];
  for (let c = b; c !== -1; c = prev.get(c)!) path.push(c);
  // „links“ bevorzugt am Atom mit kleinerer gezeichneter x-Lage beginnen
  const xa = m.atoms.find((t) => t.id === path[0])!.x, xb = m.atoms.find((t) => t.id === path[path.length - 1])!.x;
  return xa > xb ? path.reverse() : path;
}

/** Rechtwinkliges Raster-Layout (Hauptkette waagerecht, Äste senkrecht). null bei Ringen oder Kollisionen. */
function gridLayout(m: Mol): Map<number, Cell> | null {
  if (!m.atoms.length || hasRing(m)) return null;
  const pos = new Map<number, Cell>(), used = new Set<string>(), inDir = new Map<number, Cell>();
  // je Zusammenhangskomponente eine eigene Zeile
  let row = 0;
  for (const start of m.atoms) {
    if (pos.has(start.id)) continue;
    const sub: Mol = { ...m, atoms: [], bonds: m.bonds };
    const comp = new Set<number>([start.id]), q = [start.id];
    while (q.length) for (const n of neighbors(m, q.shift()!)) if (!comp.has(n)) { comp.add(n); q.push(n); }
    sub.atoms = m.atoms.filter((a) => comp.has(a.id));
    const chain = longestPath(sub);
    chain.forEach((id, i) => { const c = { x: i, y: row }; pos.set(id, c); used.add(key(c)); inDir.set(id, DIRS[0]); });
    const queue = [...chain];
    while (queue.length) {
      const a = queue.shift()!, pa = pos.get(a)!, din = inDir.get(a)!;
      const order = [din, { x: din.y, y: -din.x }, { x: -din.y, y: din.x }, { x: -din.x, y: -din.y }];
      if (din.y === 0) order.sort((u, v) => Math.abs(v.y) - Math.abs(u.y) || (u.y < v.y ? -1 : 1)); // an der Kette: erst oben, dann unten
      for (const n of neighbors(m, a)) {
        if (pos.has(n)) continue;
        const d = order.find((o) => !used.has(key({ x: pa.x + o.x, y: pa.y + o.y })));
        if (!d) return null;
        const c = { x: pa.x + d.x, y: pa.y + d.y };
        pos.set(n, c); used.add(key(c)); inDir.set(n, d); queue.push(n);
      }
    }
    row = Math.max(...[...pos.values()].map((c) => c.y)) + 3;
  }
  return pos;
}

const hLabel = (el: string, h: number, hFirst: boolean) => (h ? (hFirst ? `H${h > 1 ? h : ""}${el}` : `${el}H${h > 1 ? h : ""}`) : el);

function fullView(m: Mol, color: string): MolSvg {
  const S = 34;
  const grid = gridLayout(m);
  const nodes: Node[] = [], edges: Edge[] = [], idx = new Map<number, number>();
  const occupied = new Set<string>();
  if (grid) for (const c of grid.values()) occupied.add(key(c));
  for (const a of m.atoms) {
    const c = grid?.get(a.id);
    idx.set(a.id, nodes.length);
    nodes.push({ x: c ? c.x * S : a.x * S * 1.25, y: c ? c.y * S : a.y * S * 1.25, label: a.el });
  }
  for (const b of m.bonds) edges.push({ p: idx.get(b.a)!, q: idx.get(b.b)!, order: b.order });
  for (const a of m.atoms) {
    let h = implicitH(m, a);
    if (!h) continue;
    const ni = idx.get(a.id)!, n = nodes[ni];
    let dirs: Cell[];
    if (grid) {
      const c = grid.get(a.id)!;
      dirs = [DIRS[1], DIRS[2], DIRS[3], DIRS[0]].filter((d) => !occupied.has(key({ x: c.x + d.x, y: c.y + d.y })));
      dirs.slice(0, h).forEach((d) => occupied.add(key({ x: c.x + d.x, y: c.y + d.y })));
    } else {
      // Ring: H strahlenförmig nach außen, gleichmäßig in der größten Lücke
      const used = neighbors(m, a.id).map((id) => { const o = nodes[idx.get(id)!]; return Math.atan2(o.y - n.y, o.x - n.x); }).sort((x, y) => x - y);
      let gap = 2 * Math.PI, start = 0;
      if (used.length) {
        gap = 0;
        used.forEach((u, i) => { const v = i + 1 < used.length ? used[i + 1] : used[0] + 2 * Math.PI; if (v - u > gap) { gap = v - u; start = u; } });
      }
      dirs = Array.from({ length: h }, (_, i) => { const t = start + (gap * (i + 1)) / (h + 1); return { x: Math.cos(t), y: Math.sin(t) }; });
    }
    for (const d of dirs.slice(0, h)) {
      edges.push({ p: ni, q: nodes.length, order: 1 });
      nodes.push({ x: n.x + d.x * S, y: n.y + d.y * S, label: "H" });
      h--;
    }
    if (h > 0) n.label = hLabel(a.el, h, false); // kein Platz mehr: restliche H ins Label
  }
  return emit(nodes, edges, color);
}

function condensedView(m: Mol, color: string): MolSvg {
  const grid = gridLayout(m);
  const nodes: Node[] = [], edges: Edge[] = [], idx = new Map<number, number>();
  const labels = new Map<number, string>();
  for (const a of m.atoms) {
    const nb = neighbors(m, a.id);
    const pa = grid?.get(a.id);
    // linkes Kettenende (Nachbar nur rechts) → „H3C–“ bzw. „HO–“
    const hFirst = !!pa && nb.length === 1 && grid!.get(nb[0])!.x > pa.x;
    labels.set(a.id, hLabel(a.el, implicitH(m, a), hFirst));
  }
  if (grid) {
    // Spaltenbreite nach dem breitesten Label der Spalte
    const cols = new Map<number, number>();
    for (const a of m.atoms) { const c = grid.get(a.id)!; cols.set(c.x, Math.max(cols.get(c.x) ?? 0, labelW(labels.get(a.id)!))); }
    const xs = [...cols.keys()].sort((p, q) => p - q), cx = new Map<number, number>();
    let x = 0;
    xs.forEach((c, i) => { if (i) x += (cols.get(xs[i - 1])! + cols.get(c)!) / 2 + 22; cx.set(c, x); });
    for (const a of m.atoms) {
      const c = grid.get(a.id)!;
      idx.set(a.id, nodes.length);
      nodes.push({ x: cx.get(c.x)!, y: c.y * 40, label: labels.get(a.id)! });
    }
  } else {
    for (const a of m.atoms) { idx.set(a.id, nodes.length); nodes.push({ x: a.x * 56, y: a.y * 56, label: labels.get(a.id)! }); }
  }
  for (const b of m.bonds) edges.push({ p: idx.get(b.a)!, q: idx.get(b.b)!, order: b.order });
  return emit(nodes, edges, color);
}

/** Rechtwinklig gezeichnet (Modus „voll“)? Dann für die Skelettformel ein Zickzack aus dem Raster-Layout ableiten. */
function zigzag(m: Mol): Mol {
  const ortho = m.bonds.every((b) => {
    const p = m.atoms.find((a) => a.id === b.a)!, q = m.atoms.find((a) => a.id === b.b)!;
    const t = Math.abs(Math.atan2(q.y - p.y, q.x - p.x)) % (Math.PI / 2);
    return t < 0.05 || t > Math.PI / 2 - 0.05;
  });
  const g = ortho && m.bonds.length ? gridLayout(m) : null;
  if (!g) return m;
  return { ...m, atoms: m.atoms.map((a) => { const c = g.get(a.id)!; return { ...a, x: c.x * 0.866, y: c.y + (Math.abs(c.x) % 2 ? -0.5 : 0) }; }) };
}

function skeletalView(m0: Mol, color: string): MolSvg {
  const S = 32, m = zigzag(m0);
  const nodes: Node[] = [], edges: Edge[] = [], idx = new Map<number, number>();
  for (const a of m.atoms) {
    const nb = neighbors(m, a.id), h = implicitH(m, a);
    const show = a.el !== "C" || nb.length === 0;
    const left = nb.length === 1 && m.atoms.find((t) => t.id === nb[0])!.x > a.x + 0.3;
    idx.set(a.id, nodes.length);
    nodes.push({ x: a.x * S, y: a.y * S, label: show ? hLabel(a.el, h, left) : null });
  }
  for (const b of m.bonds) edges.push({ p: idx.get(b.a)!, q: idx.get(b.b)!, order: b.order });
  return emit(nodes, edges, color);
}

export function renderMol(m: Mol, view: MolView, color = "#111111"): MolSvg {
  if (view === "full") return fullView(m, color);
  if (view === "condensed") return condensedView(m, color);
  return skeletalView(m, color);
}

export const molSvgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
