// In-Memory-Nachbau der Rust-Repo-Logik für Browser-Entwicklung und Tests.
import type { Backend } from "./api";
import type {
  CanvasElement, ElementTag, Page, PagePatch, PageRef, SearchHit, Section, SectionPatch, Subject, SubjectPatch,
  Tag, TaggedItem, TemplateMeta, TrashItem, VersionMeta, CalendarEvent,
} from "./types";
import { BUILTIN_TAG_IDS } from "./types";
import { elementText, fold } from "./text";

interface Snap { page: Page; elements: CanvasElement[] }

const uid = () => crypto.randomUUID();
const clone = <T>(v: T): T => structuredClone(v);

function nonEmpty(v: string) {
  const t = v.trim();
  if (!t) throw new Error("Ungültig: Name darf nicht leer sein");
  return t;
}

export class MemoryBackend implements Backend {
  subjects: Subject[] = [];
  sections: Section[] = [];
  pages: Page[] = [];
  elements = new Map<string, CanvasElement>();
  deleted = new Map<string, number>();
  tags: Tag[] = [
    { id: "todo", name: "To-Do", icon: "square-check", color: "#2563eb" },
    { id: "important", name: "Wichtig", icon: "star", color: "#dc2626" },
    { id: "question", name: "Frage", icon: "circle-help", color: "#9333ea" },
    { id: "exam-prep", name: "Lernen für KA", icon: "graduation-cap", color: "#16a34a" },
  ];
  elementTags: ElementTag[] = [];
  versions: (VersionMeta & { snap: Snap })[] = [];
  templates: (TemplateMeta & { snap: Snap })[] = [];
  events: CalendarEvent[] = [];

  private subject(id: string) {
    const s = this.subjects.find((x) => x.id === id);
    if (!s) throw new Error(`Nicht gefunden: Fach ${id}`);
    return s;
  }
  private section(id: string) {
    const s = this.sections.find((x) => x.id === id);
    if (!s) throw new Error(`Nicht gefunden: Themengruppe ${id}`);
    return s;
  }
  private page(id: string) {
    const p = this.pages.find((x) => x.id === id);
    if (!p) throw new Error(`Nicht gefunden: Blatt ${id}`);
    return p;
  }
  private static nextOrder(items: { order: number }[]) {
    return items.reduce((m, x) => Math.max(m, x.order + 1), 0);
  }
  private static sameSet(a: string[], b: string[]) {
    if (a.length !== b.length || [...a].sort().join() !== [...b].sort().join())
      throw new Error("Ungültig: Sortierliste passt nicht zu den Einträgen");
  }

  async listSubjects() {
    return clone([...this.subjects].sort((a, b) => a.order - b.order));
  }
  async createSubject(name: string, color: string, icon: string) {
    const s: Subject = {
      id: uid(), name: nonEmpty(name), color, icon,
      order: MemoryBackend.nextOrder(this.subjects), webuntisSubjectId: null, moodleCourseId: null,
    };
    this.subjects.push(s);
    return clone(s);
  }
  async updateSubject(id: string, patch: SubjectPatch) {
    const s = this.subject(id);
    Object.assign(s, patch, patch.name !== undefined ? { name: nonEmpty(patch.name) } : {});
    return clone(s);
  }
  async deleteSubject(id: string) {
    this.subject(id);
    const secs = new Set(this.sections.filter((x) => x.subjectId === id).map((x) => x.id));
    this.pages = this.pages.filter((p) => !secs.has(p.sectionId));
    this.sections = this.sections.filter((x) => x.subjectId !== id);
    this.subjects = this.subjects.filter((x) => x.id !== id);
    for (const e of this.events) if (e.subjectId === id) e.subjectId = null;
  }
  async reorderSubjects(ids: string[]) {
    MemoryBackend.sameSet(this.subjects.map((s) => s.id), ids);
    ids.forEach((id, i) => (this.subject(id).order = i));
  }

  async listSections(subjectId: string) {
    return clone(this.sections.filter((s) => s.subjectId === subjectId).sort((a, b) => a.order - b.order));
  }
  async createSection(subjectId: string, name: string, color: string) {
    this.subject(subjectId);
    const s: Section = {
      id: uid(), subjectId, name: nonEmpty(name), color,
      order: MemoryBackend.nextOrder(this.sections.filter((x) => x.subjectId === subjectId)),
    };
    this.sections.push(s);
    return clone(s);
  }
  async updateSection(id: string, patch: SectionPatch) {
    const s = this.section(id);
    Object.assign(s, patch, patch.name !== undefined ? { name: nonEmpty(patch.name) } : {});
    return clone(s);
  }
  async deleteSection(id: string) {
    this.section(id);
    this.pages = this.pages.filter((p) => p.sectionId !== id);
    this.sections = this.sections.filter((s) => s.id !== id);
  }
  async reorderSections(subjectId: string, ids: string[]) {
    MemoryBackend.sameSet(this.sections.filter((s) => s.subjectId === subjectId).map((s) => s.id), ids);
    ids.forEach((id, i) => (this.section(id).order = i));
  }

  async listPages(subjectId: string) {
    const secs = this.sections.filter((s) => s.subjectId === subjectId);
    const rank = new Map(secs.map((s) => [s.id, s.order]));
    return clone(
      this.pages
        .filter((p) => rank.has(p.sectionId) && !this.deleted.has(p.id))
        .sort((a, b) => rank.get(a.sectionId)! - rank.get(b.sectionId)! || a.order - b.order),
    );
  }
  private siblings(sectionId: string, parentPageId: string | null, except?: string) {
    return this.pages
      .filter((p) => p.sectionId === sectionId && p.parentPageId === parentPageId && p.id !== except && !this.deleted.has(p.id))
      .sort((a, b) => a.order - b.order);
  }
  private descendants(id: string): string[] {
    const kids = this.pages.filter((p) => p.parentPageId === id).map((p) => p.id);
    return kids.flatMap((k) => [k, ...this.descendants(k)]);
  }
  async createPage(sectionId: string, parentPageId: string | null, title: string) {
    this.section(sectionId);
    if (parentPageId && this.page(parentPageId).sectionId !== sectionId)
      throw new Error("Ungültig: Unterseite muss in derselben Themengruppe liegen");
    const now = Date.now();
    const p: Page = {
      id: uid(), sectionId, parentPageId, title: title.trim(),
      order: MemoryBackend.nextOrder(this.siblings(sectionId, parentPageId)),
      mode: "infinite", orientation: "portrait", background: "grid", bgSpacingMm: 5,
      pageColor: "#ffffff", createdAt: now, updatedAt: now,
    };
    this.pages.push(p);
    return clone(p);
  }
  async updatePage(id: string, patch: PagePatch) {
    const p = this.page(id);
    Object.assign(p, patch, { updatedAt: Date.now() });
    if (patch.title !== undefined) p.title = patch.title.trim();
    return clone(p);
  }
  async deletePage(id: string) {
    this.page(id);
    if (this.deleted.has(id)) return;
    const now = Date.now();
    for (const x of [id, ...this.descendants(id)]) if (!this.deleted.has(x)) this.deleted.set(x, now);
  }
  private hardDelete(id: string) {
    const gone = new Set([id, ...this.descendants(id)]);
    this.pages = this.pages.filter((p) => !gone.has(p.id));
    for (const [k, e] of this.elements) if (gone.has(e.pageId)) this.elements.delete(k);
    for (const x of gone) this.deleted.delete(x);
    this.elementTags = this.elementTags.filter((t) => this.elements.has(t.elementId));
  }
  async movePage(id: string, sectionId: string, parentPageId: string | null, index: number) {
    const p = this.page(id);
    const target = this.section(sectionId);
    if (target.subjectId !== this.section(p.sectionId).subjectId)
      throw new Error("Ungültig: Blätter können nur innerhalb eines Fachs verschoben werden");
    const desc = this.descendants(id);
    if (parentPageId && (parentPageId === id || desc.includes(parentPageId)))
      throw new Error("Ungültig: Ein Blatt kann nicht in sich selbst verschoben werden");
    if (parentPageId && this.page(parentPageId).sectionId !== sectionId)
      throw new Error("Ungültig: Unterseite muss in derselben Themengruppe liegen");

    const old = { sectionId: p.sectionId, parentPageId: p.parentPageId };
    Object.assign(p, { sectionId, parentPageId, updatedAt: Date.now() });
    for (const d of desc) this.page(d).sectionId = sectionId;
    const sibs = this.siblings(sectionId, parentPageId, id);
    sibs.splice(Math.min(index, sibs.length), 0, p);
    sibs.forEach((s, i) => (s.order = i));
    this.siblings(old.sectionId, old.parentPageId, id).forEach((s, i) => (s.order = i));
    return clone(p);
  }

  async listElements(pageId: string) {
    this.page(pageId);
    return clone([...this.elements.values()].filter((e) => e.pageId === pageId).sort((a, b) => a.z - b.z));
  }

  async saveElements(pageId: string, upserts: CanvasElement[], deletes: string[]) {
    const p = this.page(pageId);
    if (upserts.some((e) => e.pageId !== pageId)) throw new Error("Ungültig: Element gehört zu einem anderen Blatt");
    for (const id of deletes) if (this.elements.get(id)?.pageId === pageId) this.elements.delete(id);
    this.elementTags = this.elementTags.filter((t) => this.elements.has(t.elementId));
    for (const e of upserts) this.elements.set(e.id, clone(e));
    p.updatedAt = Date.now();
  }

  // ---------- Phase 4 ----------
  private subjectOf(p: Page) {
    return this.subject(this.section(p.sectionId).subjectId);
  }
  private live(p: Page) {
    return !this.deleted.has(p.id);
  }

  async listTrash(subjectId: string): Promise<TrashItem[]> {
    return this.pages
      .filter((p) => this.deleted.has(p.id) && this.section(p.sectionId).subjectId === subjectId)
      .filter((p) => !p.parentPageId || this.deleted.get(p.parentPageId) !== this.deleted.get(p.id))
      .sort((a, b) => this.deleted.get(b.id)! - this.deleted.get(a.id)!)
      .map((p) => ({
        page: clone(p), sectionName: this.section(p.sectionId).name, deletedAt: this.deleted.get(p.id)!,
        childCount: this.descendants(p.id).filter((d) => this.deleted.get(d) === this.deleted.get(p.id)).length,
      }));
  }
  async restorePage(id: string) {
    const p = this.page(id);
    const ts = this.deleted.get(id);
    if (ts === undefined) return clone(p);
    const walk = (x: string) => {
      this.deleted.delete(x);
      for (const k of this.pages.filter((c) => c.parentPageId === x && this.deleted.get(c.id) === ts)) walk(k.id);
    };
    walk(id);
    if (p.parentPageId && this.deleted.has(p.parentPageId)) p.parentPageId = null;
    p.order = MemoryBackend.nextOrder(this.siblings(p.sectionId, p.parentPageId, id));
    return clone(p);
  }
  async purgePage(id: string) {
    if (!this.deleted.has(id)) throw new Error("Ungültig: Nur Blätter im Papierkorb können endgültig gelöscht werden");
    this.hardDelete(id);
  }
  async emptyTrash(subjectId: string) {
    const ids = this.pages.filter((p) => this.deleted.has(p.id) && this.section(p.sectionId).subjectId === subjectId).map((p) => p.id);
    for (const id of ids) if (this.pages.some((p) => p.id === id)) this.hardDelete(id);
    return ids.length;
  }

  private pageText(id: string) {
    return [...this.elements.values()].filter((e) => e.pageId === id).map((e) => elementText(e.type, e.data)).filter(Boolean).join("\n");
  }
  async search(query: string, limit = 50): Promise<SearchHit[]> {
    const terms = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!terms.length) return [];
    const hits: SearchHit[] = [];
    for (const p of this.pages.filter((x) => this.live(x))) {
      const body = this.pageText(p.id);
      const hay = fold(`${p.title}\n${body}`);
      if (!terms.every((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(hay))) continue;
      const src = body || p.title;
      const at = fold(src).indexOf(terms[0]);
      const start = Math.max(0, at - 30);
      const snippet = at < 0 ? src.slice(0, 80)
        : (start ? "…" : "") + src.slice(start, at) + "\u0001" + src.slice(at, at + terms[0].length) + "\u0002" + src.slice(at + terms[0].length, at + 60);
      const sub = this.subjectOf(p);
      hits.push({ pageId: p.id, subjectId: sub.id, subjectName: sub.name, subjectColor: sub.color, sectionName: this.section(p.sectionId).name, title: p.title, snippet });
    }
    return hits.slice(0, limit);
  }
  async listPageRefs(): Promise<PageRef[]> {
    return this.pages.filter((p) => this.live(p)).map((p) => {
      const s = this.subjectOf(p);
      return { pageId: p.id, subjectId: s.id, subjectName: s.name, title: p.title };
    });
  }
  async findPage(title: string, subjectId: string | null) {
    const want = title.trim().toLowerCase();
    if (!want) return null;
    const refs = (await this.listPageRefs()).filter((r) => r.title.trim().toLowerCase() === want);
    refs.sort((a, b) => Number(b.subjectId === subjectId) - Number(a.subjectId === subjectId));
    return refs[0] ?? null;
  }

  async listTags() {
    return clone(this.tags);
  }
  async createTag(name: string, icon: string, color: string) {
    const t = { id: uid(), name: nonEmpty(name), icon, color };
    this.tags.push(t);
    return clone(t);
  }
  async deleteTag(id: string) {
    if (BUILTIN_TAG_IDS.includes(id)) throw new Error("Ungültig: Standard-Tags können nicht gelöscht werden");
    this.tags = this.tags.filter((t) => t.id !== id);
    this.elementTags = this.elementTags.filter((t) => t.tagId !== id);
  }
  async setElementTag(elementId: string, tagId: string, on: boolean) {
    if (!this.elements.has(elementId)) throw new Error("Datenbankfehler: FOREIGN KEY constraint failed");
    const has = this.elementTags.some((t) => t.elementId === elementId && t.tagId === tagId);
    if (on && !has) this.elementTags.push({ elementId, tagId, done: false });
    if (!on) this.elementTags = this.elementTags.filter((t) => !(t.elementId === elementId && t.tagId === tagId));
  }
  async setTagDone(elementId: string, tagId: string, done: boolean) {
    const t = this.elementTags.find((x) => x.elementId === elementId && x.tagId === tagId);
    if (!t) throw new Error("Nicht gefunden: Tag am Element");
    t.done = done;
  }
  async listPageTags(pageId: string) {
    return clone(this.elementTags.filter((t) => this.elements.get(t.elementId)?.pageId === pageId));
  }
  async listTagged(tagId: string | null, subjectId: string | null): Promise<TaggedItem[]> {
    const out: TaggedItem[] = [];
    for (const t of this.elementTags) {
      const e = this.elements.get(t.elementId);
      if (!e || (tagId && t.tagId !== tagId)) continue;
      const p = this.page(e.pageId);
      if (!this.live(p)) continue;
      const sub = this.subjectOf(p);
      if (subjectId && sub.id !== subjectId) continue;
      out.push({
        ...t, type: e.type, pageId: p.id, pageTitle: p.title, subjectId: sub.id, subjectName: sub.name,
        subjectColor: sub.color, sectionName: this.section(p.sectionId).name, snippet: elementText(e.type, e.data).slice(0, 140),
        updatedAt: p.updatedAt,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private snap(pageId: string): Snap {
    return clone({ page: this.page(pageId), elements: [...this.elements.values()].filter((e) => e.pageId === pageId) });
  }
  private apply(pageId: string, s: Snap, withTitle: boolean, freshIds: boolean) {
    const p = this.page(pageId);
    for (const [k, e] of this.elements) if (e.pageId === pageId) this.elements.delete(k);
    for (const e of clone(s.elements)) {
      const n = { ...e, pageId, id: freshIds ? uid() : e.id };
      this.elements.set(n.id, n);
    }
    const { mode, orientation, background, bgSpacingMm, pageColor } = s.page;
    Object.assign(p, { mode, orientation, background, bgSpacingMm, pageColor, updatedAt: Date.now() }, withTitle ? { title: s.page.title } : {});
    return clone(p);
  }
  async listVersions(pageId: string) {
    return this.versions.filter((v) => v.pageId === pageId).reverse().sort((a, b) => b.createdAt - a.createdAt)
      .map(({ snap: _s, ...m }) => clone(m));
  }
  async createVersion(pageId: string, label: string) {
    const snap = this.snap(pageId);
    const v = { id: uid(), pageId, createdAt: Date.now(), label: label.trim(), elementCount: snap.elements.length, snap };
    this.versions.push(v);
    const mine = this.versions.filter((x) => x.pageId === pageId).reverse().sort((a, b) => b.createdAt - a.createdAt);
    const drop = new Set(mine.slice(50).map((x) => x.id));
    this.versions = this.versions.filter((x) => !drop.has(x.id));
    const { snap: _s, ...m } = v;
    return clone(m);
  }
  async autoVersion(pageId: string, minIntervalMs: number) {
    const p = this.page(pageId);
    const last = Math.max(-Infinity, ...this.versions.filter((v) => v.pageId === pageId).map((v) => v.createdAt));
    const n = [...this.elements.values()].filter((e) => e.pageId === pageId).length;
    const due = last === -Infinity ? n > 0 : p.updatedAt > last && Date.now() - last >= minIntervalMs;
    return due ? this.createVersion(pageId, "") : null;
  }
  async restoreVersion(id: string) {
    const v = this.versions.find((x) => x.id === id);
    if (!v) throw new Error(`Nicht gefunden: Version ${id}`);
    await this.createVersion(v.pageId, "Vor der Wiederherstellung");
    return this.apply(v.pageId, v.snap, true, false);
  }
  async deleteVersion(id: string) {
    this.versions = this.versions.filter((v) => v.id !== id);
  }
  async listTemplates() {
    return this.templates.map(({ snap: _s, ...m }) => clone(m)).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  async saveTemplate(pageId: string, name: string) {
    const snap = this.snap(pageId);
    const t = { id: uid(), name: nonEmpty(name), createdAt: Date.now(), mode: snap.page.mode, background: snap.page.background, elementCount: snap.elements.length, snap };
    this.templates.push(t);
    const { snap: _s, ...m } = t;
    return clone(m);
  }
  async deleteTemplate(id: string) {
    this.templates = this.templates.filter((t) => t.id !== id);
  }
  async createPageFromTemplate(sectionId: string, parentPageId: string | null, templateId: string, title: string) {
    const t = this.templates.find((x) => x.id === templateId);
    if (!t) throw new Error(`Nicht gefunden: Vorlage ${templateId}`);
    const p = await this.createPage(sectionId, parentPageId, title);
    return this.apply(p.id, t.snap, false, true);
  }

  // ---------- Kalender ----------
  async listEvents(from: number, to: number) {
    return clone(this.events.filter((e) => e.start < to && (e.end ?? e.start) >= from).sort((a, b) => a.start - b.start));
  }
  async saveEvent(e: CalendarEvent) {
    const title = e.title.trim();
    if (!title) throw new Error("Ungültig: Titel darf nicht leer sein");
    if (e.end != null && e.end < e.start) throw new Error("Ungültig: Ende liegt vor dem Beginn");
    const ev = { ...clone(e), title, id: e.id || uid() };
    const i = this.events.findIndex((x) => x.id === ev.id);
    if (i >= 0) this.events[i] = ev; else this.events.push(ev);
    return clone(ev);
  }
  async deleteEvent(id: string) {
    const n = this.events.length;
    this.events = this.events.filter((e) => e.id !== id);
    if (this.events.length === n) throw new Error(`Nicht gefunden: Termin ${id}`);
  }
}
