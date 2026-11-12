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
  createdAt: number;
  updatedAt: number;
}
export type PagePatch = Partial<Pick<Page, "title" | "mode" | "orientation" | "background" | "bgSpacingMm" | "pageColor">>;
