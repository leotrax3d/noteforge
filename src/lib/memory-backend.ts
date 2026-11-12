// In-Memory-Nachbau der Rust-Repo-Logik für Browser-Entwicklung und Tests.
import type { Backend } from "./api";
import type { Page, PagePatch, Section, SectionPatch, Subject, SubjectPatch } from "./types";

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
        .filter((p) => rank.has(p.sectionId))
        .sort((a, b) => rank.get(a.sectionId)! - rank.get(b.sectionId)! || a.order - b.order),
    );
  }
  private siblings(sectionId: string, parentPageId: string | null, except?: string) {
    return this.pages
      .filter((p) => p.sectionId === sectionId && p.parentPageId === parentPageId && p.id !== except)
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
    const gone = new Set([id, ...this.descendants(id)]);
    this.pages = this.pages.filter((p) => !gone.has(p.id));
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
}
