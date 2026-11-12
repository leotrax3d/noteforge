//! Phase 4 (SPEC §5): Papierkorb, Volltextsuche, Seitenlinks, Tags, Versionen, Vorlagen.

use super::models::*;
use super::repo::{get_page, get_section, list_elements, new_id, now_ms, upsert_element_raw};
use super::{Error, Result};
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use rusqlite::{params, Connection, OptionalExtension};
use std::io::{Read, Write};

/// Papierkorb-Einträge werden nach so vielen Tagen endgültig gelöscht.
pub const TRASH_DAYS: i64 = 30;
/// Höchstzahl gespeicherter Versionen pro Blatt.
pub const MAX_VERSIONS: i64 = 50;
const BUILTIN_TAGS: &[&str] = &["todo", "important", "question", "exam-prep"];

fn rows<T>(
    conn: &Connection,
    sql: &str,
    p: impl rusqlite::Params,
    f: impl FnMut(&rusqlite::Row) -> rusqlite::Result<T>,
) -> Result<Vec<T>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let it = stmt.query_map(p, f)?;
    Ok(it.collect::<rusqlite::Result<_>>()?)
}

// ---------- Wartung ----------

/// Beim Start: alten Papierkorb leeren, Suchindex aufräumen bzw. erstmalig aufbauen.
pub fn maintenance(conn: &mut Connection) -> Result<()> {
    purge_older_than(conn, now_ms() - TRASH_DAYS * 86_400_000)?;
    conn.execute("DELETE FROM page_fts WHERE page_id NOT IN (SELECT id FROM page)", [])?;
    let indexed: i64 = conn.query_row("SELECT count(*) FROM page_fts", [], |r| r.get(0))?;
    let pages: i64 = conn.query_row("SELECT count(*) FROM page", [], |r| r.get(0))?;
    if indexed < pages {
        let tx = conn.transaction()?;
        let ids: Vec<String> = rows(&tx, "SELECT id FROM page", [], |r| r.get(0))?;
        for id in ids {
            reindex_page(&tx, &id)?;
        }
        tx.commit()?;
    }
    Ok(())
}

pub fn purge_older_than(conn: &Connection, cutoff: i64) -> Result<usize> {
    let ids: Vec<String> = rows(conn, "SELECT id FROM page WHERE deleted_at IS NOT NULL AND deleted_at < ?1", [cutoff], |r| r.get(0))?;
    for id in &ids {
        hard_delete(conn, id)?;
    }
    Ok(ids.len())
}

fn hard_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM page_fts WHERE page_id IN (
           WITH RECURSIVE d(id) AS (SELECT ?1 UNION ALL SELECT p.id FROM page p JOIN d ON p.parent_page_id = d.id)
           SELECT id FROM d)",
        [id],
    )?;
    conn.execute("DELETE FROM page WHERE id=?1", [id])?;
    Ok(())
}

// ---------- Papierkorb ----------

/// Verschiebt ein Blatt samt Unterseiten in den Papierkorb.
pub fn trash_page(conn: &Connection, id: &str) -> Result<()> {
    get_page(conn, id)?;
    if deleted_at(conn, id)?.is_some() {
        return Ok(());
    }
    conn.execute(
        "WITH RECURSIVE d(id) AS (SELECT ?1 UNION ALL SELECT p.id FROM page p JOIN d ON p.parent_page_id = d.id)
         UPDATE page SET deleted_at=?2 WHERE id IN (SELECT id FROM d) AND deleted_at IS NULL",
        params![id, now_ms()],
    )?;
    Ok(())
}

fn deleted_at(conn: &Connection, id: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row("SELECT deleted_at FROM page WHERE id=?1", [id], |r| r.get::<_, Option<i64>>(0))
        .optional()?
        .flatten())
}

/// Gelöschte Blätter eines Fachs (nur die jeweils oberste gelöschte Ebene).
pub fn list_trash(conn: &Connection, subject_id: &str) -> Result<Vec<TrashItem>> {
    let ids: Vec<(String, String, i64)> = rows(
        conn,
        "SELECT p.id, s.name, p.deleted_at FROM page p JOIN section s ON s.id = p.section_id
         LEFT JOIN page par ON par.id = p.parent_page_id
         WHERE s.subject_id=?1 AND p.deleted_at IS NOT NULL
           AND (par.id IS NULL OR par.deleted_at IS NULL OR par.deleted_at <> p.deleted_at)
         ORDER BY p.deleted_at DESC",
        [subject_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    ids.into_iter()
        .map(|(id, section_name, deleted_at)| {
            let child_count: i64 = conn.query_row(
                "WITH RECURSIVE d(id) AS (SELECT id FROM page WHERE parent_page_id=?1 AND deleted_at=?2
                   UNION ALL SELECT p.id FROM page p JOIN d ON p.parent_page_id = d.id WHERE p.deleted_at=?2)
                 SELECT count(*) FROM d",
                params![id, deleted_at],
                |r| r.get(0),
            )?;
            Ok(TrashItem { page: get_page(conn, &id)?, section_name, deleted_at, child_count })
        })
        .collect()
}

/// Stellt ein Blatt mit den gemeinsam gelöschten Unterseiten wieder her.
/// Ist das Elternblatt selbst gelöscht, landet es auf oberster Ebene.
pub fn restore_page(conn: &mut Connection, id: &str) -> Result<Page> {
    let tx = conn.transaction()?;
    let p = get_page(&tx, id)?;
    let Some(ts) = deleted_at(&tx, id)? else {
        return Ok(p);
    };
    tx.execute(
        "WITH RECURSIVE d(id) AS (SELECT ?1 UNION ALL SELECT p.id FROM page p JOIN d ON p.parent_page_id = d.id WHERE p.deleted_at=?2)
         UPDATE page SET deleted_at=NULL, updated_at=?3 WHERE id IN (SELECT id FROM d)",
        params![id, ts, now_ms()],
    )?;
    let orphan = match &p.parent_page_id {
        Some(pid) => deleted_at(&tx, pid)?.is_some(),
        None => false,
    };
    let parent = if orphan { None } else { p.parent_page_id.clone() };
    tx.execute(
        "UPDATE page SET parent_page_id=?2, sort_order=(SELECT COALESCE(MAX(sort_order)+1,0) FROM page
           WHERE section_id=?3 AND parent_page_id IS ?2 AND deleted_at IS NULL AND id<>?1) WHERE id=?1",
        params![id, parent, p.section_id],
    )?;
    let out = get_page(&tx, id)?;
    tx.commit()?;
    Ok(out)
}

pub fn purge_page(conn: &Connection, id: &str) -> Result<()> {
    if deleted_at(conn, id)?.is_none() {
        return Err(Error::Invalid("Nur Blätter im Papierkorb können endgültig gelöscht werden".into()));
    }
    hard_delete(conn, id)
}

pub fn empty_trash(conn: &mut Connection, subject_id: &str) -> Result<usize> {
    let tx = conn.transaction()?;
    let ids: Vec<String> = rows(
        &tx,
        "SELECT p.id FROM page p JOIN section s ON s.id=p.section_id WHERE s.subject_id=?1 AND p.deleted_at IS NOT NULL",
        [subject_id],
        |r| r.get(0),
    )?;
    for id in &ids {
        hard_delete(&tx, id)?;
    }
    tx.commit()?;
    Ok(ids.len())
}

// ---------- Volltextsuche ----------

/// Sichtbarer Text eines Text-/Tabellen-Elements (JSON im data-Blob).
pub fn element_text(kind: &str, data: &[u8]) -> String {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(data) else {
        return String::new();
    };
    let d = &v["data"];
    match kind {
        "text" => strip_html(d["html"].as_str().unwrap_or("")),
        "pdfPage" => d["text"].as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" "),
        "table" => d["cells"]
            .as_array()
            .map(|rows| {
                rows.iter()
                    .flat_map(|r| r.as_array().into_iter().flatten())
                    .filter_map(|c| c.as_str())
                    .map(strip_html)
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(" · ")
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// Entfernt Tags, Blockgrenzen werden zu Leerzeichen, einfache Entities dekodiert.
pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match (in_tag, ch) {
            (false, '<') => {
                in_tag = true;
                out.push(' ');
            }
            (true, '>') => in_tag = false,
            (false, c) => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn reindex_page(conn: &Connection, page_id: &str) -> Result<()> {
    conn.execute("DELETE FROM page_fts WHERE page_id=?1", [page_id])?;
    let Some(title) = conn
        .query_row("SELECT title FROM page WHERE id=?1", [page_id], |r| r.get::<_, String>(0))
        .optional()?
    else {
        return Ok(());
    };
    let parts: Vec<String> = rows(
        conn,
        "SELECT type, data FROM element WHERE page_id=?1 AND type IN ('text','table','pdfPage') ORDER BY z",
        [page_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)),
    )?
    .into_iter()
    .map(|(k, d)| element_text(&k, &d))
    .filter(|s| !s.is_empty())
    .collect();
    conn.execute(
        "INSERT INTO page_fts (page_id, title, body) VALUES (?1, ?2, ?3)",
        params![page_id, title, parts.join("\n")],
    )?;
    Ok(())
}

/// Nutzereingabe → FTS5-Ausdruck: alle Wörter müssen (als Präfix) vorkommen.
pub fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

pub fn search(conn: &Connection, q: &str, limit: i64) -> Result<Vec<SearchHit>> {
    let Some(expr) = fts_query(q) else { return Ok(vec![]) };
    rows(
        conn,
        "SELECT p.id, su.id, su.name, su.color, s.name, p.title,
                snippet(page_fts, -1, char(1), char(2), '…', 12)
         FROM page_fts f JOIN page p ON p.id = f.page_id JOIN section s ON s.id = p.section_id
         JOIN subject su ON su.id = s.subject_id
         WHERE page_fts MATCH ?1 AND p.deleted_at IS NULL
         ORDER BY bm25(page_fts, 0.0, 4.0, 1.0), p.updated_at DESC LIMIT ?2",
        params![expr, limit],
        |r| {
            Ok(SearchHit {
                page_id: r.get(0)?,
                subject_id: r.get(1)?,
                subject_name: r.get(2)?,
                subject_color: r.get(3)?,
                section_name: r.get(4)?,
                title: r.get(5)?,
                snippet: r.get(6)?,
            })
        },
    )
}

// ---------- Seitenlinks [[…]] ----------

pub fn list_page_refs(conn: &Connection) -> Result<Vec<PageRef>> {
    rows(
        conn,
        "SELECT p.id, su.id, su.name, p.title FROM page p JOIN section s ON s.id=p.section_id
         JOIN subject su ON su.id=s.subject_id WHERE p.deleted_at IS NULL
         ORDER BY su.sort_order, s.sort_order, p.sort_order",
        [],
        |r| Ok(PageRef { page_id: r.get(0)?, subject_id: r.get(1)?, subject_name: r.get(2)?, title: r.get(3)? }),
    )
}

/// Blatt mit diesem Titel (ohne Groß-/Kleinschreibung); Blätter des aktuellen Fachs zuerst.
pub fn find_page(conn: &Connection, title: &str, subject_id: Option<&str>) -> Result<Option<PageRef>> {
    let want = title.trim().to_lowercase();
    if want.is_empty() {
        return Ok(None);
    }
    let mut hits: Vec<PageRef> = list_page_refs(conn)?
        .into_iter()
        .filter(|r| r.title.trim().to_lowercase() == want)
        .collect();
    hits.sort_by_key(|r| Some(r.subject_id.as_str()) != subject_id);
    Ok(hits.into_iter().next())
}

// ---------- Tags ----------

pub fn delete_custom_tag(conn: &Connection, id: &str) -> Result<()> {
    if BUILTIN_TAGS.contains(&id) {
        return Err(Error::Invalid("Standard-Tags können nicht gelöscht werden".into()));
    }
    super::repo::delete_tag(conn, id)
}

pub fn list_page_tags(conn: &Connection, page_id: &str) -> Result<Vec<ElementTag>> {
    rows(
        conn,
        "SELECT et.element_id, et.tag_id, et.done FROM element_tag et JOIN element e ON e.id = et.element_id
         WHERE e.page_id=?1 ORDER BY et.rowid",
        [page_id],
        |r| Ok(ElementTag { element_id: r.get(0)?, tag_id: r.get(1)?, done: r.get(2)? }),
    )
}

pub fn set_tag_done(conn: &Connection, element_id: &str, tag_id: &str, done: bool) -> Result<()> {
    let n = conn.execute(
        "UPDATE element_tag SET done=?3 WHERE element_id=?1 AND tag_id=?2",
        params![element_id, tag_id, done],
    )?;
    if n == 0 {
        return Err(Error::NotFound("Tag am Element".into()));
    }
    Ok(())
}

/// Tag-Übersicht: alle markierten Elemente (optional gefiltert), neueste Blätter zuerst.
pub fn list_tagged(conn: &Connection, tag_id: Option<&str>, subject_id: Option<&str>) -> Result<Vec<TaggedItem>> {
    let items = rows(
        conn,
        "SELECT et.element_id, et.tag_id, et.done, e.type, e.data, p.id, p.title, su.id, su.name, su.color,
                s.name, p.updated_at
         FROM element_tag et JOIN element e ON e.id = et.element_id JOIN page p ON p.id = e.page_id
         JOIN section s ON s.id = p.section_id JOIN subject su ON su.id = s.subject_id
         WHERE p.deleted_at IS NULL AND (?1 IS NULL OR et.tag_id = ?1) AND (?2 IS NULL OR su.id = ?2)
         ORDER BY p.updated_at DESC, e.bbox_y, e.bbox_x",
        params![tag_id, subject_id],
        |r| {
            let kind: String = r.get(3)?;
            let data: Vec<u8> = r.get(4)?;
            let mut snippet = element_text(&kind, &data);
            if snippet.chars().count() > 140 {
                snippet = snippet.chars().take(139).collect::<String>() + "…";
            }
            Ok(TaggedItem {
                element_id: r.get(0)?,
                tag_id: r.get(1)?,
                done: r.get(2)?,
                kind,
                page_id: r.get(5)?,
                page_title: r.get(6)?,
                subject_id: r.get(7)?,
                subject_name: r.get(8)?,
                subject_color: r.get(9)?,
                section_name: r.get(10)?,
                snippet,
                updated_at: r.get(11)?,
            })
        },
    )?;
    Ok(items)
}

// ---------- Snapshots (Versionen + Vorlagen) ----------

pub fn pack(s: &Snapshot) -> Result<Vec<u8>> {
    let mut z = ZlibEncoder::new(Vec::new(), Compression::default());
    z.write_all(&serde_json::to_vec(s)?)?;
    Ok(z.finish()?)
}

pub fn unpack(bytes: &[u8]) -> Result<Snapshot> {
    let mut json = Vec::new();
    ZlibDecoder::new(bytes).read_to_end(&mut json)?;
    Ok(serde_json::from_slice(&json)?)
}

fn snapshot(conn: &Connection, page_id: &str) -> Result<Snapshot> {
    Ok(Snapshot { page: get_page(conn, page_id)?, elements: list_elements(conn, page_id)? })
}

/// Ersetzt Inhalt + Einstellungen eines Blatts (Titel nur, wenn `with_title`).
fn apply_snapshot(conn: &Connection, page_id: &str, s: &Snapshot, with_title: bool, fresh_ids: bool) -> Result<Page> {
    let mut page = get_page(conn, page_id)?;
    conn.execute("DELETE FROM element WHERE page_id=?1", [page_id])?;
    for e in &s.elements {
        let mut e = e.clone();
        e.page_id = page_id.to_string();
        if fresh_ids {
            e.id = new_id();
        }
        upsert_element_raw(conn, &e)?;
    }
    if with_title {
        page.title = s.page.title.clone();
    }
    conn.execute(
        "UPDATE page SET title=?2, mode=?3, orientation=?4, background=?5, bg_spacing_mm=?6, page_color=?7,
           updated_at=?8 WHERE id=?1",
        params![
            page_id, page.title, s.page.mode, s.page.orientation, s.page.background, s.page.bg_spacing_mm,
            s.page.page_color, now_ms()
        ],
    )?;
    reindex_page(conn, page_id)?;
    get_page(conn, page_id)
}

// ---------- Seitenversionen ----------

const VERSION_COLS: &str = "id, page_id, created_at, label, element_count";

fn version_row(r: &rusqlite::Row) -> rusqlite::Result<VersionMeta> {
    Ok(VersionMeta { id: r.get(0)?, page_id: r.get(1)?, created_at: r.get(2)?, label: r.get(3)?, element_count: r.get(4)? })
}

pub fn list_versions(conn: &Connection, page_id: &str) -> Result<Vec<VersionMeta>> {
    rows(
        conn,
        &format!("SELECT {VERSION_COLS} FROM page_version WHERE page_id=?1 ORDER BY created_at DESC, rowid DESC"),
        [page_id],
        version_row,
    )
}

pub fn create_version(conn: &Connection, page_id: &str, label: &str) -> Result<VersionMeta> {
    let s = snapshot(conn, page_id)?;
    let v = VersionMeta {
        id: new_id(),
        page_id: page_id.into(),
        created_at: now_ms(),
        label: label.trim().into(),
        element_count: s.elements.len() as i64,
    };
    conn.execute(
        "INSERT INTO page_version (id, page_id, snapshot, created_at, label, element_count) VALUES (?1,?2,?3,?4,?5,?6)",
        params![v.id, v.page_id, pack(&s)?, v.created_at, v.label, v.element_count],
    )?;
    conn.execute(
        "DELETE FROM page_version WHERE page_id=?1 AND id NOT IN (
           SELECT id FROM page_version WHERE page_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2)",
        params![page_id, MAX_VERSIONS],
    )?;
    Ok(v)
}

/// Automatische Version, wenn sich das Blatt seit der letzten Version geändert hat
/// und diese mindestens `min_interval_ms` alt ist.
pub fn auto_version(conn: &Connection, page_id: &str, min_interval_ms: i64) -> Result<Option<VersionMeta>> {
    let page = get_page(conn, page_id)?;
    let last: Option<i64> =
        conn.query_row("SELECT MAX(created_at) FROM page_version WHERE page_id=?1", [page_id], |r| r.get(0))?;
    let n: i64 = conn.query_row("SELECT count(*) FROM element WHERE page_id=?1", [page_id], |r| r.get(0))?;
    let due = match last {
        None => n > 0,
        Some(t) => page.updated_at > t && now_ms() - t >= min_interval_ms,
    };
    if !due {
        return Ok(None);
    }
    create_version(conn, page_id, "").map(Some)
}

/// Stellt eine Version wieder her; der aktuelle Stand wird vorher selbst als Version gesichert.
pub fn restore_version(conn: &mut Connection, version_id: &str) -> Result<Page> {
    let tx = conn.transaction()?;
    let (page_id, bytes): (String, Vec<u8>) = tx
        .query_row("SELECT page_id, snapshot FROM page_version WHERE id=?1", [version_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("Version {version_id}")))?;
    let snap = unpack(&bytes)?;
    create_version(&tx, &page_id, "Vor der Wiederherstellung")?;
    let page = apply_snapshot(&tx, &page_id, &snap, true, false)?;
    tx.commit()?;
    Ok(page)
}

pub fn delete_version(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM page_version WHERE id=?1", [id])?;
    Ok(())
}

// ---------- Vorlagen ----------

pub fn list_templates(conn: &Connection) -> Result<Vec<TemplateMeta>> {
    let raw: Vec<(String, String, i64, Vec<u8>)> = rows(
        conn,
        "SELECT id, name, created_at, snapshot FROM template ORDER BY name COLLATE NOCASE",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    raw.into_iter()
        .map(|(id, name, created_at, b)| {
            let s = unpack(&b)?;
            Ok(TemplateMeta {
                id,
                name,
                created_at,
                mode: s.page.mode,
                background: s.page.background,
                element_count: s.elements.len() as i64,
            })
        })
        .collect()
}

pub fn save_template(conn: &Connection, page_id: &str, name: &str) -> Result<TemplateMeta> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("Name darf nicht leer sein".into()));
    }
    let s = snapshot(conn, page_id)?;
    let t = TemplateMeta {
        id: new_id(),
        name: name.into(),
        created_at: now_ms(),
        mode: s.page.mode.clone(),
        background: s.page.background.clone(),
        element_count: s.elements.len() as i64,
    };
    conn.execute(
        "INSERT INTO template (id, name, snapshot, created_at) VALUES (?1,?2,?3,?4)",
        params![t.id, t.name, pack(&s)?, t.created_at],
    )?;
    Ok(t)
}

pub fn delete_template(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM template WHERE id=?1", [id])?;
    Ok(())
}

/// Neues Blatt aus einer eigenen Vorlage (Elemente erhalten neue IDs).
pub fn create_page_from_template(
    conn: &mut Connection,
    section_id: &str,
    parent_page_id: Option<&str>,
    template_id: &str,
    title: &str,
) -> Result<Page> {
    let tx = conn.transaction()?;
    get_section(&tx, section_id)?;
    let bytes: Vec<u8> = tx
        .query_row("SELECT snapshot FROM template WHERE id=?1", [template_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("Vorlage {template_id}")))?;
    let snap = unpack(&bytes)?;
    let page = super::repo::create_page(&tx, section_id, parent_page_id, title)?;
    let page = apply_snapshot(&tx, &page.id, &snap, false, true)?;
    tx.commit()?;
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::*;
    use crate::db::Db;

    struct Fx {
        db: Db,
        subject: String,
        section: String,
    }
    fn fx() -> Fx {
        let db = Db::open_in_memory().unwrap();
        let (subject, section) = {
            let c = db.conn();
            let s = create_subject(&c, "Physik", "#f00", "atom").unwrap();
            let sec = create_section(&c, &s.id, "Mechanik", "#00f").unwrap();
            (s.id, sec.id)
        };
        Fx { db, subject, section }
    }
    fn text_el(page: &str, id: &str, html: &str) -> Element {
        let data = serde_json::json!({"v":1,"x":0,"y":0,"w":10,"h":10,"angle":0,"data":{"html":html}});
        Element {
            id: id.into(), page_id: page.into(), kind: "text".into(), z: 0,
            bbox: BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 }, data: serde_json::to_vec(&data).unwrap(),
        }
    }

    #[test]
    fn trash_restore_purge() {
        let f = fx();
        let mut c = f.db.conn();
        let a = create_page(&c, &f.section, None, "A").unwrap();
        let a1 = create_page(&c, &f.section, Some(&a.id), "A1").unwrap();
        let b = create_page(&c, &f.section, None, "B").unwrap();
        delete_page(&c, &a1.id).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        delete_page(&c, &a.id).unwrap(); // später gelöscht → eigener Eintrag
        assert_eq!(list_pages(&c, &f.subject).unwrap().len(), 1);
        let trash = list_trash(&c, &f.subject).unwrap();
        assert_eq!(trash.iter().map(|t| t.page.title.as_str()).collect::<Vec<_>>(), ["A", "A1"]);

        // Unterseite zuerst wiederherstellen → Elternblatt ist gelöscht → oberste Ebene
        let r = restore_page(&mut c, &a1.id).unwrap();
        assert_eq!(r.parent_page_id, None);
        let titles: Vec<_> = list_pages(&c, &f.subject).unwrap().into_iter().map(|p| p.title).collect();
        assert_eq!(titles, ["B", "A1"]);

        // Elternblatt samt gleichzeitig gelöschten Kindern
        let c1 = create_page(&c, &f.section, Some(&b.id), "B1").unwrap();
        delete_page(&c, &b.id).unwrap();
        let t = list_trash(&c, &f.subject).unwrap();
        assert_eq!(t.iter().find(|x| x.page.id == b.id).unwrap().child_count, 1);
        restore_page(&mut c, &b.id).unwrap();
        assert!(list_pages(&c, &f.subject).unwrap().iter().any(|p| p.id == c1.id));

        assert!(purge_page(&c, &b.id).is_err(), "nur aus dem Papierkorb");
        assert_eq!(empty_trash(&mut c, &f.subject).unwrap(), 1);
        assert!(get_page(&c, &a.id).is_err());
        assert_eq!(purge_older_than(&c, i64::MAX).unwrap(), 0);
    }

    #[test]
    fn full_text_search() {
        let f = fx();
        let mut c = f.db.conn();
        let p = create_page(&c, &f.section, None, "Hebelgesetz").unwrap();
        let q = create_page(&c, &f.section, None, "Reibung").unwrap();
        save_elements(&mut c, &p.id, &[text_el(&p.id, "t1", "<b>Kraft</b> mal Kraftarm &amp; Last")], &[]).unwrap();
        save_elements(&mut c, &q.id, &[text_el(&q.id, "t2", "Haftreibung ist größer als Gleitreibung")], &[]).unwrap();

        let hit = search(&c, "kraft", 10).unwrap();
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].title, "Hebelgesetz");
        assert!(hit[0].snippet.contains("\u{1}Kraft\u{2}"), "{}", hit[0].snippet);
        assert_eq!(search(&c, "GROSSER", 10).unwrap().len(), 0, "ß ≠ ss, aber Diakritika egal:");
        assert_eq!(search(&c, "grosser gleit", 10).unwrap().len(), 0);
        assert_eq!(search(&c, "größer gleit", 10).unwrap()[0].page_id, q.id);
        assert_eq!(search(&c, "hebel", 10).unwrap()[0].page_id, p.id, "Titel");
        assert!(search(&c, "\"*()", 10).unwrap().is_empty(), "Sonderzeichen sicher");

        update_page(&c, &q.id, PagePatch { title: Some("Kraft und Reibung".into()), ..Default::default() }).unwrap();
        assert_eq!(search(&c, "kraft", 10).unwrap().len(), 2);
        delete_page(&c, &p.id).unwrap();
        assert_eq!(search(&c, "kraft", 10).unwrap().len(), 1, "Papierkorb wird nicht durchsucht");
        save_elements(&mut c, &q.id, &[], &["t2".into()]).unwrap();
        assert!(search(&c, "haftreibung", 10).unwrap().is_empty());
    }

    #[test]
    fn index_rebuilt_on_start() {
        let f = fx();
        let mut c = f.db.conn();
        let p = create_page(&c, &f.section, None, "Optik").unwrap();
        c.execute("DELETE FROM page_fts", []).unwrap();
        maintenance(&mut c).unwrap();
        assert_eq!(search(&c, "optik", 5).unwrap()[0].page_id, p.id);
    }

    #[test]
    fn page_links() {
        let f = fx();
        let c = f.db.conn();
        let p = create_page(&c, &f.section, None, "Ohmsches Gesetz").unwrap();
        let r = find_page(&c, "  ohmsches GESETZ ", Some(&f.subject)).unwrap().unwrap();
        assert_eq!(r.page_id, p.id);
        assert_eq!(r.subject_name, "Physik");
        assert!(find_page(&c, "Gibt es nicht", None).unwrap().is_none());
        assert_eq!(list_page_refs(&c).unwrap().len(), 1);
    }

    #[test]
    fn tags_and_overview() {
        let f = fx();
        let mut c = f.db.conn();
        let p = create_page(&c, &f.section, None, "HA").unwrap();
        save_elements(&mut c, &p.id, &[text_el(&p.id, "t1", "Aufgabe 3 rechnen")], &[]).unwrap();
        set_element_tag(&c, "t1", "todo", true).unwrap();
        set_element_tag(&c, "t1", "important", true).unwrap();
        set_tag_done(&c, "t1", "todo", true).unwrap();
        assert!(set_tag_done(&c, "t1", "question", true).is_err());
        let tags = list_page_tags(&c, &p.id).unwrap();
        assert_eq!(tags.len(), 2);
        assert!(tags.iter().any(|t| t.tag_id == "todo" && t.done));
        let todo = list_tagged(&c, Some("todo"), None).unwrap();
        assert_eq!(todo.len(), 1);
        assert_eq!(todo[0].snippet, "Aufgabe 3 rechnen");
        assert_eq!(list_tagged(&c, None, Some(&f.subject)).unwrap().len(), 2);
        assert!(delete_custom_tag(&c, "todo").is_err());
        let own = create_tag(&c, "Referat", "mic", "#0aa").unwrap();
        delete_custom_tag(&c, &own.id).unwrap();
        delete_page(&c, &p.id).unwrap();
        assert!(list_tagged(&c, None, None).unwrap().is_empty());
    }

    #[test]
    fn versions_roundtrip() {
        let f = fx();
        let mut c = f.db.conn();
        let p = create_page(&c, &f.section, None, "Skizze").unwrap();
        assert!(auto_version(&c, &p.id, 0).unwrap().is_none(), "leeres Blatt");
        save_elements(&mut c, &p.id, &[text_el(&p.id, "t1", "Erster Stand")], &[]).unwrap();
        let v1 = auto_version(&c, &p.id, 0).unwrap().unwrap();
        assert_eq!(v1.element_count, 1);
        assert!(auto_version(&c, &p.id, 0).unwrap().is_none(), "unverändert");

        save_elements(&mut c, &p.id, &[text_el(&p.id, "t2", "Zweiter")], &["t1".into()]).unwrap();
        update_page(&c, &p.id, PagePatch { title: Some("Neu".into()), background: Some("dots".into()), ..Default::default() }).unwrap();
        let back = restore_version(&mut c, &v1.id).unwrap();
        assert_eq!(back.title, "Skizze");
        assert_eq!(back.background, "grid");
        let els = list_elements(&c, &p.id).unwrap();
        assert_eq!(els.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["t1"]);
        assert_eq!(search(&c, "erster", 5).unwrap().len(), 1);
        let vs = list_versions(&c, &p.id).unwrap();
        assert_eq!(vs.len(), 2);
        assert_eq!(vs[0].label, "Vor der Wiederherstellung");
        for _ in 0..(MAX_VERSIONS + 5) {
            create_version(&c, &p.id, "x").unwrap();
        }
        assert_eq!(list_versions(&c, &p.id).unwrap().len() as i64, MAX_VERSIONS);
        delete_version(&c, &vs[0].id).unwrap();
    }

    #[test]
    fn templates() {
        let f = fx();
        let mut c = f.db.conn();
        let p = create_page(&c, &f.section, None, "Muster").unwrap();
        update_page(&c, &p.id, PagePatch { mode: Some("a4".into()), background: Some("lines".into()), ..Default::default() }).unwrap();
        save_elements(&mut c, &p.id, &[text_el(&p.id, "t1", "Überschrift")], &[]).unwrap();
        let t = save_template(&c, &p.id, " Versuchsprotokoll ").unwrap();
        assert!(save_template(&c, &p.id, " ").is_err());
        let list = list_templates(&c).unwrap();
        assert_eq!(list[0].name, "Versuchsprotokoll");
        assert_eq!((list[0].mode.as_str(), list[0].element_count), ("a4", 1));
        let n = create_page_from_template(&mut c, &f.section, None, &t.id, "Versuch 1").unwrap();
        assert_eq!((n.title.as_str(), n.mode.as_str(), n.background.as_str()), ("Versuch 1", "a4", "lines"));
        let els = list_elements(&c, &n.id).unwrap();
        assert_eq!(els.len(), 1);
        assert_ne!(els[0].id, "t1", "neue IDs");
        delete_template(&c, &t.id).unwrap();
        assert!(list_templates(&c).unwrap().is_empty());
    }

    #[test]
    fn html_text() {
        assert_eq!(strip_html("<h1>Titel</h1><p>a&nbsp;&lt;b&gt;</p><ul><li>x</li></ul>"), "Titel a <b> x");
        assert_eq!(fts_query("Kraft-arm 3"), Some("\"Kraft\"* \"arm\"* \"3\"*".into()));
    }
}
