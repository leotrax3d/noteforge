// Reine Baumlogik für die Fach-Sidebar (Blätter + Unterblätter). Ohne React, testbar.
import type { Page } from "./types";

export interface FlatPage {
  page: Page;
  depth: number;
  hasChildren: boolean;
}

const byOrder = (a: Page, b: Page) => a.order - b.order;

/** Blätter eines Themas in Anzeige-Reihenfolge (Tiefensuche); eingeklappte Äste fehlen. */
export function flattenSection(pages: Page[], sectionId: string, collapsed: ReadonlySet<string> = new Set()): FlatPage[] {
  const inSection = pages.filter((p) => p.sectionId === sectionId);
  const children = new Map<string | null, Page[]>();
  for (const p of inSection) {
    const key = p.parentPageId;
    const list = children.get(key);
    if (list) list.push(p);
    else children.set(key, [p]);
  }
  const out: FlatPage[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of (children.get(parent) ?? []).sort(byOrder)) {
      const hasChildren = children.has(p.id);
      out.push({ page: p, depth, hasChildren });
      if (hasChildren && !collapsed.has(p.id)) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function isDescendant(pages: Page[], ancestorId: string, id: string): boolean {
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (let cur = byId.get(id)?.parentPageId; cur; cur = byId.get(cur)?.parentPageId) {
    if (cur === ancestorId) return true;
  }
  return false;
}

export interface PageDrop {
  sectionId: string;
  parentPageId: string | null;
  index: number;
}

/**
 * Ziel für das Ablegen von `activeId` auf `overId`.
 * - `nest`: als letzte Unterblatt von `over`
 * - sonst: an die Stelle von `over` unter dessen Elternteil (nach unten gezogen: dahinter)
 * Liefert `null`, wenn das Ablegen keinen Sinn ergibt (auf sich selbst / eigene Unterseite).
 */
export function pageDropTarget(pages: Page[], activeId: string, overId: string, nest: boolean): PageDrop | null {
  if (activeId === overId) return null;
  const active = pages.find((p) => p.id === activeId);
  const over = pages.find((p) => p.id === overId);
  if (!active || !over || isDescendant(pages, activeId, overId)) return null;

  const siblingsOf = (sectionId: string, parent: string | null) =>
    pages.filter((p) => p.sectionId === sectionId && p.parentPageId === parent && p.id !== activeId).sort(byOrder);

  if (nest) {
    return { sectionId: over.sectionId, parentPageId: over.id, index: siblingsOf(over.sectionId, over.id).length };
  }
  const sibs = siblingsOf(over.sectionId, over.parentPageId);
  let index = sibs.findIndex((p) => p.id === overId);
  const sameList = active.sectionId === over.sectionId && active.parentPageId === over.parentPageId;
  if (sameList && active.order < over.order) index += 1;
  return { sectionId: over.sectionId, parentPageId: over.parentPageId, index };
}

/** Ziel für „Ebene höher“: direkt hinter dem bisherigen Elternblatt. */
export function outdentTarget(pages: Page[], id: string): PageDrop | null {
  const p = pages.find((x) => x.id === id);
  const parent = p?.parentPageId ? pages.find((x) => x.id === p.parentPageId) : undefined;
  if (!p || !parent) return null;
  const sibs = pages
    .filter((x) => x.sectionId === parent.sectionId && x.parentPageId === parent.parentPageId)
    .sort(byOrder);
  return { sectionId: parent.sectionId, parentPageId: parent.parentPageId, index: sibs.findIndex((x) => x.id === parent.id) + 1 };
}

/** Ziel für „Einrücken“: letzte Unterblatt des vorherigen Geschwisters. */
export function indentTarget(pages: Page[], id: string): PageDrop | null {
  const p = pages.find((x) => x.id === id);
  if (!p) return null;
  const sibs = pages
    .filter((x) => x.sectionId === p.sectionId && x.parentPageId === p.parentPageId)
    .sort(byOrder);
  const prev = sibs[sibs.findIndex((x) => x.id === id) - 1];
  if (!prev) return null;
  const kids = pages.filter((x) => x.parentPageId === prev.id).length;
  return { sectionId: p.sectionId, parentPageId: prev.id, index: kids };
}

export function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
