//! CRUD-Funktionen auf einer `Connection`. Bewusst frei von Tauri, damit testbar.

use super::models::*;
use super::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::time::{SystemTime, UNIX_EPOCH};

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn non_empty(name: &str, what: &str) -> Result<String> {
    let t = name.trim();
    if t.is_empty() {
        return Err(Error::Invalid(format!("{what} darf nicht leer sein")));
    }
    Ok(t.to_string())
}

fn one_of(v: &str, allowed: &[&str], what: &str) -> Result<()> {
    if allowed.contains(&v) {
        Ok(())
    } else {
        Err(Error::Invalid(format!("{what}: unbekannter Wert „{v}“")))
    }
}

fn changed(n: usize, what: &str, id: &str) -> Result<()> {
    if n == 0 {
        Err(Error::NotFound(format!("{what} {id}")))
    } else {
        Ok(())
    }
}

/// Schreibt `sort_order = Position` für die gegebene Reihenfolge.
fn write_order(conn: &Connection, table: &str, ids: &[String]) -> Result<()> {
    let sql = format!("UPDATE {table} SET sort_order = ?1 WHERE id = ?2");
    let mut stmt = conn.prepare_cached(&sql)?;
    for (i, id) in ids.iter().enumerate() {
        stmt.execute(params![i as i64, id])?;
    }
    Ok(())
}

/// Prüft, dass `ids` genau eine Permutation von `existing` ist.
fn same_set(existing: &[String], ids: &[String]) -> Result<()> {
    let mut a = existing.to_vec();
    let mut b = ids.to_vec();
    a.sort();
    b.sort();
    if a != b {
        return Err(Error::Invalid("Sortierliste passt nicht zu den Einträgen".into()));
    }
    Ok(())
}

fn ids(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let rows = stmt.query_map(p, |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------- Subject ----------

const SUBJECT_COLS: &str =
    "id, name, color, icon, sort_order, webuntis_subject_id, moodle_course_id";

fn subject_row(r: &Row) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        icon: r.get(3)?,
        order: r.get(4)?,
        webuntis_subject_id: r.get(5)?,
        moodle_course_id: r.get(6)?,
    })
}

pub fn list_subjects(conn: &Connection) -> Result<Vec<Subject>> {
    let mut stmt =
        conn.prepare_cached(&format!("SELECT {SUBJECT_COLS} FROM subject ORDER BY sort_order"))?;
    let rows = stmt.query_map([], subject_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_subject(conn: &Connection, id: &str) -> Result<Subject> {
    conn.query_row(
        &format!("SELECT {SUBJECT_COLS} FROM subject WHERE id = ?1"),
        [id],
        subject_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound(format!("Fach {id}")))
}

pub fn create_subject(conn: &Connection, name: &str, color: &str, icon: &str) -> Result<Subject> {
    let name = non_empty(name, "Name")?;
    let id = new_id();
    conn.execute(
        "INSERT INTO subject (id, name, color, icon, sort_order)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM subject))",
        params![id, name, color, icon],
    )?;
    get_subject(conn, &id)
}

pub fn update_subject(conn: &Connection, id: &str, p: SubjectPatch) -> Result<Subject> {
    let mut s = get_subject(conn, id)?;
    if let Some(v) = p.name {
        s.name = non_empty(&v, "Name")?;
    }
    if let Some(v) = p.color {
        s.color = v;
    }
    if let Some(v) = p.icon {
        s.icon = v;
    }
    if let Some(v) = p.webuntis_subject_id {
        s.webuntis_subject_id = v;
    }
    if let Some(v) = p.moodle_course_id {
        s.moodle_course_id = v;
    }
    conn.execute(
        "UPDATE subject SET name=?2, color=?3, icon=?4, webuntis_subject_id=?5, moodle_course_id=?6
         WHERE id=?1",
        params![s.id, s.name, s.color, s.icon, s.webuntis_subject_id, s.moodle_course_id],
    )?;
    Ok(s)
}

pub fn delete_subject(conn: &Connection, id: &str) -> Result<()> {
    changed(conn.execute("DELETE FROM subject WHERE id=?1", [id])?, "Fach", id)
}

pub fn reorder_subjects(conn: &mut Connection, order: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    same_set(&ids(&tx, "SELECT id FROM subject", [])?, order)?;
    write_order(&tx, "subject", order)?;
    tx.commit()?;
    Ok(())
}

// ---------- Section ----------

fn section_row(r: &Row) -> rusqlite::Result<Section> {
    Ok(Section {
        id: r.get(0)?,
        subject_id: r.get(1)?,
        name: r.get(2)?,
        color: r.get(3)?,
        order: r.get(4)?,
    })
}

pub fn list_sections(conn: &Connection, subject_id: &str) -> Result<Vec<Section>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, subject_id, name, color, sort_order FROM section
         WHERE subject_id=?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([subject_id], section_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_section(conn: &Connection, id: &str) -> Result<Section> {
    conn.query_row(
        "SELECT id, subject_id, name, color, sort_order FROM section WHERE id=?1",
        [id],
        section_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound(format!("Themengruppe {id}")))
}

pub fn create_section(conn: &Connection, subject_id: &str, name: &str, color: &str) -> Result<Section> {
    let name = non_empty(name, "Name")?;
    get_subject(conn, subject_id)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO section (id, subject_id, name, color, sort_order)
         VALUES (?1, ?2, ?3, ?4,
           (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM section WHERE subject_id=?2))",
        params![id, subject_id, name, color],
    )?;
    get_section(conn, &id)
}

pub fn update_section(conn: &Connection, id: &str, p: SectionPatch) -> Result<Section> {
    let mut s = get_section(conn, id)?;
    if let Some(v) = p.name {
        s.name = non_empty(&v, "Name")?;
    }
    if let Some(v) = p.color {
        s.color = v;
    }
    conn.execute(
        "UPDATE section SET name=?2, color=?3 WHERE id=?1",
        params![s.id, s.name, s.color],
    )?;
    Ok(s)
}

pub fn delete_section(conn: &Connection, id: &str) -> Result<()> {
    changed(conn.execute("DELETE FROM section WHERE id=?1", [id])?, "Themengruppe", id)
}

pub fn reorder_sections(conn: &mut Connection, subject_id: &str, order: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    same_set(&ids(&tx, "SELECT id FROM section WHERE subject_id=?1", [subject_id])?, order)?;
    write_order(&tx, "section", order)?;
    tx.commit()?;
    Ok(())
}

// ---------- Page ----------

const PAGE_COLS: &str = "p.id, p.section_id, p.parent_page_id, p.title, p.sort_order, p.mode,
    p.orientation, p.background, p.bg_spacing_mm, p.page_color, p.created_at, p.updated_at";

fn page_row(r: &Row) -> rusqlite::Result<Page> {
    Ok(Page {
        id: r.get(0)?,
        section_id: r.get(1)?,
        parent_page_id: r.get(2)?,
        title: r.get(3)?,
        order: r.get(4)?,
        mode: r.get(5)?,
        orientation: r.get(6)?,
        background: r.get(7)?,
        bg_spacing_mm: r.get(8)?,
        page_color: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

/// Alle Blätter eines Fachs (über alle Themengruppen), nach Gruppe/Elternteil/Reihenfolge.
pub fn list_pages(conn: &Connection, subject_id: &str) -> Result<Vec<Page>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {PAGE_COLS} FROM page p JOIN section s ON s.id = p.section_id
         WHERE s.subject_id=?1 ORDER BY s.sort_order, p.sort_order"
    ))?;
    let rows = stmt.query_map([subject_id], page_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_page(conn: &Connection, id: &str) -> Result<Page> {
    conn.query_row(
        &format!("SELECT {PAGE_COLS} FROM page p WHERE p.id=?1"),
        [id],
        page_row,
    )
    .optional()?
    .ok_or_else(|| Error::NotFound(format!("Blatt {id}")))
}

fn check_parent(conn: &Connection, section_id: &str, parent: Option<&str>) -> Result<()> {
    if let Some(pid) = parent {
        let p = get_page(conn, pid)?;
        if p.section_id != section_id {
            return Err(Error::Invalid("Unterseite muss in derselben Themengruppe liegen".into()));
        }
    }
    Ok(())
}

pub fn create_page(
    conn: &Connection,
    section_id: &str,
    parent_page_id: Option<&str>,
    title: &str,
) -> Result<Page> {
    get_section(conn, section_id)?;
    check_parent(conn, section_id, parent_page_id)?;
    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO page (id, section_id, parent_page_id, title, sort_order, mode, orientation,
           background, bg_spacing_mm, page_color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4,
           (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM page
             WHERE section_id=?2 AND parent_page_id IS ?3),
           'infinite', 'portrait', 'grid', 5.0, '#ffffff', ?5, ?5)",
        params![id, section_id, parent_page_id, title.trim(), now],
    )?;
    get_page(conn, &id)
}

pub fn update_page(conn: &Connection, id: &str, p: PagePatch) -> Result<Page> {
    let mut pg = get_page(conn, id)?;
    if let Some(v) = p.title {
        pg.title = v.trim().to_string();
    }
    if let Some(v) = p.mode {
        one_of(&v, &["infinite", "a4"], "Modus")?;
        pg.mode = v;
    }
    if let Some(v) = p.orientation {
        one_of(&v, &["portrait", "landscape"], "Ausrichtung")?;
        pg.orientation = v;
    }
    if let Some(v) = p.background {
        one_of(&v, &["grid", "lines", "dots", "blank"], "Hintergrund")?;
        pg.background = v;
    }
    if let Some(v) = p.bg_spacing_mm {
        if !(1.0..=50.0).contains(&v) {
            return Err(Error::Invalid("Linienabstand muss zwischen 1 und 50 mm liegen".into()));
        }
        pg.bg_spacing_mm = v;
    }
    if let Some(v) = p.page_color {
        pg.page_color = v;
    }
    pg.updated_at = now_ms();
    conn.execute(
        "UPDATE page SET title=?2, mode=?3, orientation=?4, background=?5, bg_spacing_mm=?6,
           page_color=?7, updated_at=?8 WHERE id=?1",
        params![
            pg.id, pg.title, pg.mode, pg.orientation, pg.background, pg.bg_spacing_mm,
            pg.page_color, pg.updated_at
        ],
    )?;
    Ok(pg)
}

pub fn delete_page(conn: &Connection, id: &str) -> Result<()> {
    changed(conn.execute("DELETE FROM page WHERE id=?1", [id])?, "Blatt", id)
}

fn descendants(conn: &Connection, id: &str) -> Result<Vec<String>> {
    ids(
        conn,
        "WITH RECURSIVE d(id) AS (
           SELECT id FROM page WHERE parent_page_id=?1
           UNION ALL SELECT p.id FROM page p JOIN d ON p.parent_page_id = d.id)
         SELECT id FROM d",
        [id],
    )
}

/// Verschiebt ein Blatt (samt Unterseiten) an Position `index` unter `parent_page_id`
/// in `section_id`. Geschwister werden lückenlos neu nummeriert.
pub fn move_page(
    conn: &mut Connection,
    id: &str,
    section_id: &str,
    parent_page_id: Option<&str>,
    index: usize,
) -> Result<Page> {
    let tx = conn.transaction()?;
    let page = get_page(&tx, id)?;
    let target = get_section(&tx, section_id)?;
    let source = get_section(&tx, &page.section_id)?;
    if target.subject_id != source.subject_id {
        return Err(Error::Invalid("Blätter können nur innerhalb eines Fachs verschoben werden".into()));
    }
    let desc = descendants(&tx, id)?;
    if let Some(pid) = parent_page_id {
        if pid == id || desc.iter().any(|d| d == pid) {
            return Err(Error::Invalid("Ein Blatt kann nicht in sich selbst verschoben werden".into()));
        }
    }
    check_parent(&tx, section_id, parent_page_id)?;

    tx.execute(
        "UPDATE page SET section_id=?2, parent_page_id=?3, updated_at=?4 WHERE id=?1",
        params![id, section_id, parent_page_id, now_ms()],
    )?;
    if page.section_id != section_id {
        let mut stmt = tx.prepare_cached("UPDATE page SET section_id=?2 WHERE id=?1")?;
        for d in &desc {
            stmt.execute(params![d, section_id])?;
        }
    }

    let sibling_sql = "SELECT id FROM page WHERE section_id=?1 AND parent_page_id IS ?2 AND id<>?3
                       ORDER BY sort_order";
    let mut sibs = ids(&tx, sibling_sql, params![section_id, parent_page_id, id])?;
    sibs.insert(index.min(sibs.len()), id.to_string());
    write_order(&tx, "page", &sibs)?;

    if page.section_id != section_id || page.parent_page_id.as_deref() != parent_page_id {
        let old = ids(
            &tx,
            sibling_sql,
            params![page.section_id, page.parent_page_id, id],
        )?;
        write_order(&tx, "page", &old)?;
    }
    let moved = get_page(&tx, id)?;
    tx.commit()?;
    Ok(moved)
}

// ---------- Element ----------

pub fn list_elements(conn: &Connection, page_id: &str) -> Result<Vec<Element>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, page_id, type, z, bbox_x, bbox_y, bbox_w, bbox_h, data FROM element
         WHERE page_id=?1 ORDER BY z",
    )?;
    let rows = stmt.query_map([page_id], |r| {
        Ok(Element {
            id: r.get(0)?,
            page_id: r.get(1)?,
            kind: r.get(2)?,
            z: r.get(3)?,
            bbox: BBox { x: r.get(4)?, y: r.get(5)?, w: r.get(6)?, h: r.get(7)? },
            data: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn upsert_element(conn: &Connection, e: &Element) -> Result<()> {
    one_of(
        &e.kind,
        &["stroke", "shape", "text", "image", "pdfPage", "file", "table"],
        "Elementtyp",
    )?;
    conn.execute(
        "INSERT INTO element (id, page_id, type, z, bbox_x, bbox_y, bbox_w, bbox_h, data)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET type=excluded.type, z=excluded.z, bbox_x=excluded.bbox_x,
           bbox_y=excluded.bbox_y, bbox_w=excluded.bbox_w, bbox_h=excluded.bbox_h, data=excluded.data",
        params![e.id, e.page_id, e.kind, e.z, e.bbox.x, e.bbox.y, e.bbox.w, e.bbox.h, e.data],
    )?;
    conn.execute("UPDATE page SET updated_at=?2 WHERE id=?1", params![e.page_id, now_ms()])?;
    Ok(())
}

/// Autospeichern: Upserts + Löschungen eines Blatts in einer Transaktion.
pub fn save_elements(conn: &mut Connection, page_id: &str, upserts: &[Element], deletes: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut del = tx.prepare_cached("DELETE FROM element WHERE id=?1 AND page_id=?2")?;
        for id in deletes {
            del.execute(params![id, page_id])?;
        }
        for e in upserts {
            if e.page_id != page_id {
                return Err(Error::Invalid("Element gehört zu einem anderen Blatt".into()));
            }
            upsert_element(&tx, e)?;
        }
        tx.execute("UPDATE page SET updated_at=?2 WHERE id=?1", params![page_id, now_ms()])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_element(conn: &Connection, id: &str) -> Result<()> {
    changed(conn.execute("DELETE FROM element WHERE id=?1", [id])?, "Element", id)
}

// ---------- Tag ----------

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare_cached("SELECT id, name, icon, color FROM tag ORDER BY rowid")?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag { id: r.get(0)?, name: r.get(1)?, icon: r.get(2)?, color: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn create_tag(conn: &Connection, name: &str, icon: &str, color: &str) -> Result<Tag> {
    let t = Tag { id: new_id(), name: non_empty(name, "Name")?, icon: icon.into(), color: color.into() };
    conn.execute(
        "INSERT INTO tag (id, name, icon, color) VALUES (?1,?2,?3,?4)",
        params![t.id, t.name, t.icon, t.color],
    )?;
    Ok(t)
}

pub fn delete_tag(conn: &Connection, id: &str) -> Result<()> {
    changed(conn.execute("DELETE FROM tag WHERE id=?1", [id])?, "Tag", id)
}

pub fn set_element_tag(conn: &Connection, element_id: &str, tag_id: &str, on: bool) -> Result<()> {
    if on {
        conn.execute(
            "INSERT OR IGNORE INTO element_tag (element_id, tag_id) VALUES (?1, ?2)",
            [element_id, tag_id],
        )?;
    } else {
        conn.execute(
            "DELETE FROM element_tag WHERE element_id=?1 AND tag_id=?2",
            [element_id, tag_id],
        )?;
    }
    Ok(())
}

// ---------- Event ----------

fn validate_event(e: &Event) -> Result<()> {
    non_empty(&e.title, "Titel")?;
    one_of(&e.kind, &["exam", "test", "deadline", "other"], "Termintyp")?;
    one_of(&e.source, &["manual", "moodle"], "Quelle")?;
    if matches!(e.end, Some(end) if end < e.start) {
        return Err(Error::Invalid("Ende liegt vor dem Beginn".into()));
    }
    Ok(())
}

pub fn list_events(conn: &Connection, from: i64, to: i64) -> Result<Vec<Event>> {
    let mut stmt = conn.prepare_cached(
        r#"SELECT id, subject_id, type, title, start, "end", note, source FROM event
           WHERE start < ?2 AND COALESCE("end", start) >= ?1 ORDER BY start"#,
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(Event {
            id: r.get(0)?,
            subject_id: r.get(1)?,
            kind: r.get(2)?,
            title: r.get(3)?,
            start: r.get(4)?,
            end: r.get(5)?,
            note: r.get(6)?,
            source: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Legt an (leere `id`) oder aktualisiert.
pub fn save_event(conn: &Connection, mut e: Event) -> Result<Event> {
    validate_event(&e)?;
    if e.id.is_empty() {
        e.id = new_id();
    }
    conn.execute(
        r#"INSERT INTO event (id, subject_id, type, title, start, "end", note, source)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
           ON CONFLICT(id) DO UPDATE SET subject_id=excluded.subject_id, type=excluded.type,
             title=excluded.title, start=excluded.start, "end"=excluded."end",
             note=excluded.note, source=excluded.source"#,
        params![e.id, e.subject_id, e.kind, e.title.trim(), e.start, e.end, e.note, e.source],
    )?;
    Ok(e)
}

pub fn delete_event(conn: &Connection, id: &str) -> Result<()> {
    changed(conn.execute("DELETE FROM event WHERE id=?1", [id])?, "Termin", id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn db() -> Db {
        Db::open_in_memory().unwrap()
    }

    #[test]
    fn save_elements_batch() {
        let d = db();
        let mut c = d.conn();
        let s = create_subject(&c, "Mathe", "#f00", "calculator").unwrap();
        let sec = create_section(&c, &s.id, "Analysis", "#00f").unwrap();
        let p = create_page(&c, &sec.id, None, "Blatt").unwrap();
        let el = |id: &str, z| Element {
            id: id.into(), page_id: p.id.clone(), kind: "stroke".into(), z,
            bbox: BBox { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, data: vec![1, 2, 3],
        };
        save_elements(&mut c, &p.id, &[el("a", 0), el("b", 1)], &[]).unwrap();
        save_elements(&mut c, &p.id, &[el("c", 2)], &["a".into()]).unwrap();
        let ids: Vec<_> = list_elements(&c, &p.id).unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["b", "c"]);
        let mut bad = el("x", 3);
        bad.page_id = "anders".into();
        assert!(save_elements(&mut c, &p.id, &[bad], &["b".into()]).is_err());
        assert_eq!(list_elements(&c, &p.id).unwrap().len(), 2, "Rollback bei Fehler");
    }

    #[test]
    fn migrations_are_idempotent() {
        let d = db();
        let mut c = d.conn();
        crate::db::migrate(&mut c).unwrap();
        let v: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        let v = v as usize;
        assert_eq!(v, crate::db::schema_version());
        assert_eq!(list_tags(&c).unwrap().len(), 4);
    }

    #[test]
    fn subjects_crud_and_order() {
        let d = db();
        let mut c = d.conn();
        let a = create_subject(&c, "Mathe", "#f00", "calculator").unwrap();
        let b = create_subject(&c, " Deutsch ", "#0f0", "book").unwrap();
        assert_eq!((a.order, b.order, b.name.as_str()), (0, 1, "Deutsch"));
        assert!(create_subject(&c, "  ", "#000", "x").is_err());

        reorder_subjects(&mut c, &[b.id.clone(), a.id.clone()]).unwrap();
        let names: Vec<_> = list_subjects(&c).unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["Deutsch", "Mathe"]);
        assert!(reorder_subjects(&mut c, &[a.id.clone()]).is_err());

        let u = update_subject(&c, &a.id, SubjectPatch { name: Some("Mathematik".into()), ..Default::default() }).unwrap();
        assert_eq!((u.name.as_str(), u.icon.as_str()), ("Mathematik", "calculator"));

        delete_subject(&c, &a.id).unwrap();
        assert!(matches!(delete_subject(&c, &a.id), Err(Error::NotFound(_))));
    }

    #[test]
    fn cascade_delete() {
        let d = db();
        let c = d.conn();
        let s = create_subject(&c, "Bio", "#0a0", "leaf").unwrap();
        let sec = create_section(&c, &s.id, "Zellen", "#0a0").unwrap();
        let p = create_page(&c, &sec.id, None, "Mitose").unwrap();
        create_page(&c, &sec.id, Some(&p.id), "Detail").unwrap();
        delete_subject(&c, &s.id).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM page", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn move_pages_between_parents_and_sections() {
        let d = db();
        let mut c = d.conn();
        let s = create_subject(&c, "Physik", "#00f", "atom").unwrap();
        let s1 = create_section(&c, &s.id, "Mechanik", "#00f").unwrap();
        let s2 = create_section(&c, &s.id, "Optik", "#00f").unwrap();
        let a = create_page(&c, &s1.id, None, "A").unwrap();
        let b = create_page(&c, &s1.id, None, "B").unwrap();
        let cc = create_page(&c, &s1.id, None, "C").unwrap();
        let child = create_page(&c, &s1.id, Some(&a.id), "A1").unwrap();
        assert_eq!(child.order, 0);

        // C an den Anfang
        move_page(&mut c, &cc.id, &s1.id, None, 0).unwrap();
        let order: Vec<_> = list_pages(&c, &s.id).unwrap().into_iter()
            .filter(|p| p.parent_page_id.is_none()).map(|p| p.title).collect();
        assert_eq!(order, ["C", "A", "B"]);

        // B wird Unterseite von A (hinter A1)
        let m = move_page(&mut c, &b.id, &s1.id, Some(&a.id), 9).unwrap();
        assert_eq!((m.parent_page_id.as_deref(), m.order), (Some(a.id.as_str()), 1));

        // Zyklus verhindern
        assert!(move_page(&mut c, &a.id, &s1.id, Some(&child.id), 0).is_err());

        // A samt Unterseiten in andere Gruppe
        move_page(&mut c, &a.id, &s2.id, None, 0).unwrap();
        assert_eq!(get_page(&c, &child.id).unwrap().section_id, s2.id);
        assert_eq!(get_page(&c, &cc.id).unwrap().order, 0);

        // Fachfremde Gruppe abgelehnt
        let other = create_subject(&c, "Chemie", "#f0f", "flask").unwrap();
        let os = create_section(&c, &other.id, "X", "#f0f").unwrap();
        assert!(move_page(&mut c, &a.id, &os.id, None, 0).is_err());
    }

    #[test]
    fn page_patch_validation() {
        let d = db();
        let c = d.conn();
        let s = create_subject(&c, "Kunst", "#fa0", "palette").unwrap();
        let sec = create_section(&c, &s.id, "Farbe", "#fa0").unwrap();
        let p = create_page(&c, &sec.id, None, "Skizze").unwrap();
        assert_eq!((p.mode.as_str(), p.background.as_str(), p.bg_spacing_mm), ("infinite", "grid", 5.0));
        let u = update_page(&c, &p.id, PagePatch { mode: Some("a4".into()), background: Some("lines".into()), bg_spacing_mm: Some(8.0), ..Default::default() }).unwrap();
        assert_eq!((u.mode.as_str(), u.bg_spacing_mm), ("a4", 8.0));
        assert!(update_page(&c, &p.id, PagePatch { mode: Some("rolle".into()), ..Default::default() }).is_err());
    }

    #[test]
    fn elements_tags_events() {
        let d = db();
        let c = d.conn();
        let s = create_subject(&c, "Geo", "#0aa", "globe").unwrap();
        let sec = create_section(&c, &s.id, "Karten", "#0aa").unwrap();
        let p = create_page(&c, &sec.id, None, "Europa").unwrap();
        let mut e = Element { id: "e1".into(), page_id: p.id.clone(), kind: "stroke".into(), z: 0,
            bbox: BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }, data: vec![1, 2, 3] };
        upsert_element(&c, &e).unwrap();
        e.z = 5;
        upsert_element(&c, &e).unwrap();
        assert_eq!(list_elements(&c, &p.id).unwrap(), vec![e]);
        set_element_tag(&c, "e1", "todo", true).unwrap();
        set_element_tag(&c, "e1", "todo", true).unwrap();

        let ev = save_event(&c, Event { id: String::new(), subject_id: Some(s.id.clone()), kind: "exam".into(),
            title: "KA 1".into(), start: 1000, end: None, note: String::new(), source: "manual".into() }).unwrap();
        assert_eq!(list_events(&c, 0, 2000).unwrap().len(), 1);
        assert!(list_events(&c, 1001, 2000).unwrap().is_empty());
        delete_subject(&c, &s.id).unwrap();
        assert_eq!(list_events(&c, 0, 2000).unwrap()[0].subject_id, None);
        delete_event(&c, &ev.id).unwrap();
    }
}
