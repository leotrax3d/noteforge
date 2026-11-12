// Einziger Zugang des Frontends zur Persistenz: Tauri-Commands.
// Außerhalb von Tauri (Vite im Browser, Tests) springt ein In-Memory-Backend ein.
import { invoke } from "@tauri-apps/api/core";
import type { Page, PagePatch, Section, SectionPatch, Subject, SubjectPatch } from "./types";
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
};

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api: Backend = inTauri ? tauri : new MemoryBackend();
