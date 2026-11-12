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
pub fn save_elements(db: S, page_id: String, upserts: Vec<Element>, deletes: Vec<String>) -> Result<()> {
    repo::save_elements(&mut db.conn(), &page_id, &upserts, &deletes)
}
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

// ---------- Phase 4 ----------
use crate::db::onenote as on;

#[tauri::command]
pub fn list_trash(db: S, subject_id: String) -> Result<Vec<TrashItem>> { on::list_trash(&db.conn(), &subject_id) }
#[tauri::command]
pub fn restore_page(db: S, id: String) -> Result<Page> { on::restore_page(&mut db.conn(), &id) }
#[tauri::command]
pub fn purge_page(db: S, id: String) -> Result<()> { on::purge_page(&db.conn(), &id) }
#[tauri::command]
pub fn empty_trash(db: S, subject_id: String) -> Result<usize> { on::empty_trash(&mut db.conn(), &subject_id) }

#[tauri::command]
pub fn search(db: S, query: String, limit: Option<i64>) -> Result<Vec<SearchHit>> {
    on::search(&db.conn(), &query, limit.unwrap_or(50).clamp(1, 200))
}
#[tauri::command]
pub fn list_page_refs(db: S) -> Result<Vec<PageRef>> { on::list_page_refs(&db.conn()) }
#[tauri::command]
pub fn find_page(db: S, title: String, subject_id: Option<String>) -> Result<Option<PageRef>> {
    on::find_page(&db.conn(), &title, subject_id.as_deref())
}

#[tauri::command]
pub fn delete_custom_tag(db: S, id: String) -> Result<()> { on::delete_custom_tag(&db.conn(), &id) }
#[tauri::command]
pub fn list_page_tags(db: S, page_id: String) -> Result<Vec<ElementTag>> { on::list_page_tags(&db.conn(), &page_id) }
#[tauri::command]
pub fn set_tag_done(db: S, element_id: String, tag_id: String, done: bool) -> Result<()> {
    on::set_tag_done(&db.conn(), &element_id, &tag_id, done)
}
#[tauri::command]
pub fn list_tagged(db: S, tag_id: Option<String>, subject_id: Option<String>) -> Result<Vec<TaggedItem>> {
    on::list_tagged(&db.conn(), tag_id.as_deref(), subject_id.as_deref())
}

#[tauri::command]
pub fn list_versions(db: S, page_id: String) -> Result<Vec<VersionMeta>> { on::list_versions(&db.conn(), &page_id) }
#[tauri::command]
pub fn create_version(db: S, page_id: String, label: String) -> Result<VersionMeta> {
    on::create_version(&db.conn(), &page_id, &label)
}
#[tauri::command]
pub fn auto_version(db: S, page_id: String, min_interval_ms: i64) -> Result<Option<VersionMeta>> {
    on::auto_version(&db.conn(), &page_id, min_interval_ms)
}
#[tauri::command]
pub fn restore_version(db: S, id: String) -> Result<Page> { on::restore_version(&mut db.conn(), &id) }
#[tauri::command]
pub fn delete_version(db: S, id: String) -> Result<()> { on::delete_version(&db.conn(), &id) }

#[tauri::command]
pub fn list_templates(db: S) -> Result<Vec<TemplateMeta>> { on::list_templates(&db.conn()) }
#[tauri::command]
pub fn save_template(db: S, page_id: String, name: String) -> Result<TemplateMeta> {
    on::save_template(&db.conn(), &page_id, &name)
}
#[tauri::command]
pub fn delete_template(db: S, id: String) -> Result<()> { on::delete_template(&db.conn(), &id) }
#[tauri::command]
pub fn create_page_from_template(
    db: S, section_id: String, parent_page_id: Option<String>, template_id: String, title: String,
) -> Result<Page> {
    on::create_page_from_template(&mut db.conn(), &section_id, parent_page_id.as_deref(), &template_id, &title)
}

/// Export (PDF): Rohdaten im Body, Zielpfad (vom Speichern-Dialog) im Header `x-path`.
#[tauri::command]
pub fn write_export(request: tauri::ipc::Request) -> Result<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(crate::db::Error::Invalid("Erwartet Binärdaten".into()));
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or_else(|| crate::db::Error::Invalid("Kein Zielpfad".into()))?;
    let path = std::path::PathBuf::from(path);
    if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")) != Some(true) {
        return Err(crate::db::Error::Invalid("Nur PDF-Dateien können exportiert werden".into()));
    }
    std::fs::write(&path, bytes)?;
    Ok(())
}

/// Asset (Original-PDF) speichern: Rohdaten im Body, Blatt in `x-page`, Typ in `x-mime`. Liefert die ID (Inhalts-Hash).
#[tauri::command]
pub fn put_asset(db: S, request: tauri::ipc::Request) -> Result<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(crate::db::Error::Invalid("Erwartet Binärdaten".into()));
    };
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(percent_decode);
    let page = h("x-page").ok_or_else(|| crate::db::Error::Invalid("Kein Blatt".into()))?;
    let mime = h("x-mime").unwrap_or_else(|| "application/pdf".into());
    crate::db::repo::put_asset(&db.conn(), &page, &mime, bytes)
}

/// Asset als Rohdaten (ohne JSON-Umweg).
#[tauri::command]
pub fn get_asset(db: S, id: String) -> Result<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(crate::db::repo::get_asset(&db.conn(), &id)?))
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len()
            && let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}


// ---------- Phase 10: Hausaufgaben + Noten ----------
use crate::db::school::{self, GradeConfig, Grade, Homework};

#[tauri::command]
pub fn list_homework(db: S, done_since: i64) -> Result<Vec<Homework>> { school::list_homework(&db.conn(), done_since) }
#[tauri::command]
pub fn save_homework(db: S, homework: Homework) -> Result<Homework> { school::save_homework(&db.conn(), homework) }
#[tauri::command]
pub fn set_homework_done(db: S, id: String, done: bool) -> Result<Homework> { school::set_homework_done(&db.conn(), &id, done) }
#[tauri::command]
pub fn delete_homework(db: S, id: String) -> Result<()> { school::delete_homework(&db.conn(), &id) }
#[tauri::command]
pub fn list_grades(db: S) -> Result<Vec<Grade>> { school::list_grades(&db.conn()) }
#[tauri::command]
pub fn save_grade(db: S, grade: Grade) -> Result<Grade> { school::save_grade(&db.conn(), grade) }
#[tauri::command]
pub fn delete_grade(db: S, id: String) -> Result<()> { school::delete_grade(&db.conn(), &id) }
#[tauri::command]
pub fn grade_config(db: S) -> Result<GradeConfig> { school::grade_config(&db.conn()) }
#[tauri::command]
pub fn set_subject_weight(db: S, subject_id: String, written_pct: i64) -> Result<()> {
    school::set_subject_weight(&db.conn(), &subject_id, written_pct)
}
#[tauri::command]
pub fn set_grade_scale(db: S, scale: String) -> Result<()> { school::set_grade_scale(&mut db.conn(), &scale) }

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent() {
        assert_eq!(super::percent_decode("C%3A%5CNotizen%5CM%C3%BCll.pdf"), "C:\\Notizen\\Müll.pdf");
        assert_eq!(super::percent_decode("a%2"), "a%2");
    }
}
