//! Tauri-Commands: dünne Hülle um `db::repo`.

use crate::db::{models::*, repo, Db, Result};
use tauri::State;

type S<'a> = State<'a, Db>;

#[tauri::command]
pub fn list_subjects(db: S) -> Result<Vec<Subject>> { repo::list_subjects(&db.conn()) }
#[tauri::command]
pub fn create_subject(db: S, name: String, color: String, icon: String) -> Result<Subject> {
    repo::create_subject(&db.conn(), &name, &color, &icon)
}
#[tauri::command]
pub fn update_subject(db: S, id: String, patch: SubjectPatch) -> Result<Subject> {
    repo::update_subject(&db.conn(), &id, patch)
}
#[tauri::command]
pub fn delete_subject(db: S, id: String) -> Result<()> { repo::delete_subject(&db.conn(), &id) }
#[tauri::command]
pub fn reorder_subjects(db: S, ids: Vec<String>) -> Result<()> {
    repo::reorder_subjects(&mut db.conn(), &ids)
}

#[tauri::command]
pub fn list_sections(db: S, subject_id: String) -> Result<Vec<Section>> {
    repo::list_sections(&db.conn(), &subject_id)
}
#[tauri::command]
pub fn create_section(db: S, subject_id: String, name: String, color: String) -> Result<Section> {
    repo::create_section(&db.conn(), &subject_id, &name, &color)
}
#[tauri::command]
pub fn update_section(db: S, id: String, patch: SectionPatch) -> Result<Section> {
    repo::update_section(&db.conn(), &id, patch)
}
#[tauri::command]
pub fn delete_section(db: S, id: String) -> Result<()> { repo::delete_section(&db.conn(), &id) }
#[tauri::command]
pub fn reorder_sections(db: S, subject_id: String, ids: Vec<String>) -> Result<()> {
    repo::reorder_sections(&mut db.conn(), &subject_id, &ids)
}

#[tauri::command]
pub fn list_pages(db: S, subject_id: String) -> Result<Vec<Page>> {
    repo::list_pages(&db.conn(), &subject_id)
}
#[tauri::command]
pub fn create_page(db: S, section_id: String, parent_page_id: Option<String>, title: String) -> Result<Page> {
    repo::create_page(&db.conn(), &section_id, parent_page_id.as_deref(), &title)
}
#[tauri::command]
pub fn update_page(db: S, id: String, patch: PagePatch) -> Result<Page> {
    repo::update_page(&db.conn(), &id, patch)
}
#[tauri::command]
pub fn delete_page(db: S, id: String) -> Result<()> { repo::delete_page(&db.conn(), &id) }
#[tauri::command]
pub fn move_page(db: S, id: String, section_id: String, parent_page_id: Option<String>, index: usize) -> Result<Page> {
    repo::move_page(&mut db.conn(), &id, &section_id, parent_page_id.as_deref(), index)
}

#[tauri::command]
pub fn list_elements(db: S, page_id: String) -> Result<Vec<Element>> {
    repo::list_elements(&db.conn(), &page_id)
}
#[tauri::command]
pub fn upsert_element(db: S, element: Element) -> Result<()> { repo::upsert_element(&db.conn(), &element) }
#[tauri::command]
pub fn delete_element(db: S, id: String) -> Result<()> { repo::delete_element(&db.conn(), &id) }

#[tauri::command]
pub fn list_tags(db: S) -> Result<Vec<Tag>> { repo::list_tags(&db.conn()) }
#[tauri::command]
pub fn create_tag(db: S, name: String, icon: String, color: String) -> Result<Tag> {
    repo::create_tag(&db.conn(), &name, &icon, &color)
}
#[tauri::command]
pub fn delete_tag(db: S, id: String) -> Result<()> { repo::delete_tag(&db.conn(), &id) }
#[tauri::command]
pub fn set_element_tag(db: S, element_id: String, tag_id: String, on: bool) -> Result<()> {
    repo::set_element_tag(&db.conn(), &element_id, &tag_id, on)
}

#[tauri::command]
pub fn list_events(db: S, from: i64, to: i64) -> Result<Vec<Event>> { repo::list_events(&db.conn(), from, to) }
#[tauri::command]
pub fn save_event(db: S, event: Event) -> Result<Event> { repo::save_event(&db.conn(), event) }
#[tauri::command]
pub fn delete_event(db: S, id: String) -> Result<()> { repo::delete_event(&db.conn(), &id) }
