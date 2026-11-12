// Spiegel der Rust-Modelle (src-tauri/src/db/models.rs), SPEC §3.

export interface Subject {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
  webuntisSubjectId: number | null;
  moodleCourseId: number | null;
}
export type SubjectPatch = Partial<Pick<Subject, "name" | "color" | "icon" | "webuntisSubjectId" | "moodleCourseId">>;

export interface Section {
  id: string;
  subjectId: string;
  name: string;
  color: string;
  order: number;
}
export type SectionPatch = Partial<Pick<Section, "name" | "color">>;

export type PageMode = "infinite" | "a4";
export type PageOrientation = "portrait" | "landscape";
export type PageBackground = "grid" | "lines" | "dots" | "blank";

export interface Page {
  id: string;
  sectionId: string;
  parentPageId: string | null;
  title: string;
  order: number;
  mode: PageMode;
  orientation: PageOrientation;
  background: PageBackground;
  bgSpacingMm: number;
  pageColor: string;
  /** "auto": aus dem Inhalt gebildet, "manual": vom Nutzer vergeben (nie automatisch überschrieben) */
  titleSource: "auto" | "manual";
  createdAt: number;
  updatedAt: number;
}
export type PagePatch = Partial<Pick<Page, "title" | "mode" | "orientation" | "background" | "bgSpacingMm" | "pageColor" | "titleSource">>;

export type ElementType = "stroke" | "shape" | "text" | "image" | "pdfPage" | "file" | "table";
export interface BBox { x: number; y: number; w: number; h: number }
export interface CanvasElement {
  id: string;
  pageId: string;
  type: ElementType;
  z: number;
  bbox: BBox;
  /** Binärdaten; über Tauri als Zahlen-Array serialisiert. */
  data: number[];
}

// ---------- Phase 4 (SPEC §5) ----------
export interface Tag { id: string; name: string; icon: string; color: string }
export const BUILTIN_TAG_IDS = ["todo", "important", "question", "exam-prep"];

export interface TrashItem { page: Page; sectionName: string; deletedAt: number; childCount: number }
export interface PageRef { pageId: string; subjectId: string; subjectName: string; title: string }
export interface SearchHit {
  pageId: string; subjectId: string; subjectName: string; subjectColor: string;
  sectionName: string; title: string;
  /** Treffer zwischen \u0001 und \u0002. */
  snippet: string;
}
export interface ElementTag { elementId: string; tagId: string; done: boolean }
export interface TaggedItem extends ElementTag {
  type: ElementType; pageId: string; pageTitle: string; subjectId: string; subjectName: string;
  subjectColor: string; sectionName: string; snippet: string; updatedAt: number;
}
export interface VersionMeta { id: string; pageId: string; createdAt: number; label: string; elementCount: number }
export interface TemplateMeta { id: string; name: string; createdAt: number; mode: PageMode; background: PageBackground; elementCount: number }

// ---------- Phase 5: Kalender (SPEC §3) ----------
export type EventKind = "exam" | "test" | "deadline" | "other";
export interface CalendarEvent {
  id: string;
  subjectId: string | null;
  type: EventKind;
  title: string;
  /** ms seit Epoche */
  start: number;
  end: number | null;
  note: string;
  source: "manual" | "moodle";
  /** Erinnerung in Minuten vor Beginn, null = keine. */
  remindBefore: number | null;
}
