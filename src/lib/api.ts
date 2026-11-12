// Einziger Zugang des Frontends zur Persistenz: Tauri-Commands.
// Außerhalb von Tauri (Vite im Browser, Tests) springt ein In-Memory-Backend ein.
import { invoke } from "@tauri-apps/api/core";
import type {
  CanvasElement, ElementTag, Page, PagePatch, PageRef, SearchHit, Section, SectionPatch, Subject, SubjectPatch,
  Tag, TaggedItem, TemplateMeta, TrashItem, VersionMeta,
} from "./types";
import { MemoryBackend } from "./memory-backend";

export interface Backend {
  listSubjects(): Promise<Subject[]>;
  createSubject(name: string, color: string, icon: string): Promise<Subject>;
  updateSubject(id: string, patch: SubjectPatch): Promise<Subject>;
  deleteSubject(id: string): Promise<void>;
  reorderSubjects(ids: string[]): Promise<void>;

  listSections(subjectId: string): Promise<Section[]>;
  createSection(subjectId: string, name: string, color: string): Promise<Section>;
  updateSection(id: string, patch: SectionPatch): Promise<Section>;
  deleteSection(id: string): Promise<void>;
  reorderSections(subjectId: string, ids: string[]): Promise<void>;

  listPages(subjectId: string): Promise<Page[]>;
  createPage(sectionId: string, parentPageId: string | null, title: string): Promise<Page>;
  updatePage(id: string, patch: PagePatch): Promise<Page>;
  deletePage(id: string): Promise<void>;
  movePage(id: string, sectionId: string, parentPageId: string | null, index: number): Promise<Page>;

  listElements(pageId: string): Promise<CanvasElement[]>;
  saveElements(pageId: string, upserts: CanvasElement[], deletes: string[]): Promise<void>;

  // Papierkorb
  listTrash(subjectId: string): Promise<TrashItem[]>;
  restorePage(id: string): Promise<Page>;
  purgePage(id: string): Promise<void>;
  emptyTrash(subjectId: string): Promise<number>;
  // Suche + Seitenlinks
  search(query: string, limit?: number): Promise<SearchHit[]>;
  listPageRefs(): Promise<PageRef[]>;
  findPage(title: string, subjectId: string | null): Promise<PageRef | null>;
  // Tags
  listTags(): Promise<Tag[]>;
  createTag(name: string, icon: string, color: string): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  setElementTag(elementId: string, tagId: string, on: boolean): Promise<void>;
  setTagDone(elementId: string, tagId: string, done: boolean): Promise<void>;
  listPageTags(pageId: string): Promise<ElementTag[]>;
  listTagged(tagId: string | null, subjectId: string | null): Promise<TaggedItem[]>;
  // Versionen
  listVersions(pageId: string): Promise<VersionMeta[]>;
  createVersion(pageId: string, label: string): Promise<VersionMeta>;
  autoVersion(pageId: string, minIntervalMs: number): Promise<VersionMeta | null>;
  restoreVersion(id: string): Promise<Page>;
  deleteVersion(id: string): Promise<void>;
  // Vorlagen
  listTemplates(): Promise<TemplateMeta[]>;
  saveTemplate(pageId: string, name: string): Promise<TemplateMeta>;
  deleteTemplate(id: string): Promise<void>;
  createPageFromTemplate(sectionId: string, parentPageId: string | null, templateId: string, title: string): Promise<Page>;
}

const tauri: Backend = {
  listSubjects: () => invoke("list_subjects"),
  createSubject: (name, color, icon) => invoke("create_subject", { name, color, icon }),
  updateSubject: (id, patch) => invoke("update_subject", { id, patch }),
  deleteSubject: (id) => invoke("delete_subject", { id }),
  reorderSubjects: (ids) => invoke("reorder_subjects", { ids }),

  listSections: (subjectId) => invoke("list_sections", { subjectId }),
  createSection: (subjectId, name, color) => invoke("create_section", { subjectId, name, color }),
  updateSection: (id, patch) => invoke("update_section", { id, patch }),
  deleteSection: (id) => invoke("delete_section", { id }),
  reorderSections: (subjectId, ids) => invoke("reorder_sections", { subjectId, ids }),

  listPages: (subjectId) => invoke("list_pages", { subjectId }),
  createPage: (sectionId, parentPageId, title) => invoke("create_page", { sectionId, parentPageId, title }),
  updatePage: (id, patch) => invoke("update_page", { id, patch }),
  deletePage: (id) => invoke("delete_page", { id }),
  movePage: (id, sectionId, parentPageId, index) =>
    invoke("move_page", { id, sectionId, parentPageId, index }),

  listElements: (pageId) => invoke("list_elements", { pageId }),
  saveElements: (pageId, upserts, deletes) => invoke("save_elements", { pageId, upserts, deletes }),

  listTrash: (subjectId) => invoke("list_trash", { subjectId }),
  restorePage: (id) => invoke("restore_page", { id }),
  purgePage: (id) => invoke("purge_page", { id }),
  emptyTrash: (subjectId) => invoke("empty_trash", { subjectId }),
  search: (query, limit) => invoke("search", { query, limit }),
  listPageRefs: () => invoke("list_page_refs"),
  findPage: (title, subjectId) => invoke("find_page", { title, subjectId }),
  listTags: () => invoke("list_tags"),
  createTag: (name, icon, color) => invoke("create_tag", { name, icon, color }),
  deleteTag: (id) => invoke("delete_custom_tag", { id }),
  setElementTag: (elementId, tagId, on) => invoke("set_element_tag", { elementId, tagId, on }),
  setTagDone: (elementId, tagId, done) => invoke("set_tag_done", { elementId, tagId, done }),
  listPageTags: (pageId) => invoke("list_page_tags", { pageId }),
  listTagged: (tagId, subjectId) => invoke("list_tagged", { tagId, subjectId }),
  listVersions: (pageId) => invoke("list_versions", { pageId }),
  createVersion: (pageId, label) => invoke("create_version", { pageId, label }),
  autoVersion: (pageId, minIntervalMs) => invoke("auto_version", { pageId, minIntervalMs }),
  restoreVersion: (id) => invoke("restore_version", { id }),
  deleteVersion: (id) => invoke("delete_version", { id }),
  listTemplates: () => invoke("list_templates"),
  saveTemplate: (pageId, name) => invoke("save_template", { pageId, name }),
  deleteTemplate: (id) => invoke("delete_template", { id }),
  createPageFromTemplate: (sectionId, parentPageId, templateId, title) =>
    invoke("create_page_from_template", { sectionId, parentPageId, templateId, title }),
};

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api: Backend = inTauri ? tauri : new MemoryBackend();

/**
 * Speichert eine exportierte Datei: in Tauri über den Speichern-Dialog + Rust-Command
 * (das Frontend schreibt nie selbst), im Browser als Download. Liefert false bei Abbruch.
 */
export async function saveExport(bytes: Uint8Array, fileName: string): Promise<boolean> {
  if (!inTauri) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: fileName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return false;
  await invoke("write_export", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  return true;
}
