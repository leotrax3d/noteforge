//! Phase 10: Hausaufgaben-Liste und Notenrechner. Die Rechenlogik (Schnitte, Zielnote) liegt im Frontend;
//! hier nur Persistenz und Validierung.

use super::repo::{new_id, now_ms};
use super::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Homework {
    #[serde(default)]
    pub id: String,
    pub subject_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub note: String,
    pub due: Option<i64>,
    pub done_at: Option<i64>,
    #[serde(default = "manual")]
    pub source: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    /// WebUntis: Originalfach (Kurz- oder Langname), Ausgabedatum, Lehrkraft – nur lesend.
    #[serde(default)]
    pub untis_subject: String,
    #[serde(default)]
    pub assigned_at: Option<i64>,
    #[serde(default)]
    pub teacher: String,
}

fn manual() -> String {
    "manual".into()
}

const HW_COLS: &str = "id, subject_id, title, note, due, done_at, source, url, created_at, updated_at";
const HW_SELECT: &str = "id, subject_id, title, note, due, done_at, source, url, created_at, updated_at, untis_subject, assigned_at, teacher";

fn hw_row(r: &Row) -> rusqlite::Result<Homework> {
    Ok(Homework {
        id: r.get(0)?,
        subject_id: r.get(1)?,
        title: r.get(2)?,
        note: r.get(3)?,
        due: r.get(4)?,
        done_at: r.get(5)?,
        source: r.get(6)?,
        url: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
        untis_subject: r.get(10)?,
        assigned_at: r.get(11)?,
        teacher: r.get(12)?,
    })
}

/// Offene Aufgaben (nach Fälligkeit, ohne Termin zuletzt) plus erledigte seit `done_since`.
pub fn list_homework(conn: &Connection, done_since: i64) -> Result<Vec<Homework>> {
    let mut st = conn.prepare_cached(&format!(
        "SELECT {HW_SELECT} FROM homework WHERE dismissed=0 AND (done_at IS NULL OR done_at >= ?1)
         ORDER BY done_at IS NOT NULL, due IS NULL, due, created_at"
    ))?;
    let rows = st.query_map([done_since], hw_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Legt an (leere `id`) oder aktualisiert. Bei Moodle-Aufgaben bleiben Titel/Frist/Quelle vom Abgleich.
pub fn save_homework(conn: &Connection, mut h: Homework) -> Result<Homework> {
    let title = h.title.trim().to_string();
    if title.is_empty() {
        return Err(Error::Invalid("Titel darf nicht leer sein".into()));
    }
    let now = now_ms();
    if h.id.is_empty() {
        h.id = new_id();
        h.source = "manual".into();
        h.created_at = now;
    }
    h.title = title;
    h.updated_at = now;
    let existing: Option<String> =
        conn.query_row("SELECT source FROM homework WHERE id=?1", [&h.id], |r| r.get(0)).optional()?;
    match existing.as_deref() {
        Some("moodle" | "webuntis") => {
            conn.execute(
                "UPDATE homework SET subject_id=?2, note=?3, done_at=?4, updated_at=?5 WHERE id=?1",
                params![h.id, h.subject_id, h.note, h.done_at, now],
            )?;
        }
        Some(_) => {
            conn.execute(
                "UPDATE homework SET subject_id=?2, title=?3, note=?4, due=?5, done_at=?6, updated_at=?7 WHERE id=?1",
                params![h.id, h.subject_id, h.title, h.note, h.due, h.done_at, now],
            )?;
        }
        None => {
            if h.source != "manual" {
                return Err(Error::Invalid("Nur eigene Aufgaben können angelegt werden".into()));
            }
            conn.execute(
                &format!("INSERT INTO homework ({HW_COLS}) VALUES (?1,?2,?3,?4,?5,?6,'manual',?7,?8,?9)"),
                params![h.id, h.subject_id, h.title, h.note, h.due, h.done_at, h.url, h.created_at, now],
            )?;
        }
    }
    get_homework(conn, &h.id)
}

pub fn get_homework(conn: &Connection, id: &str) -> Result<Homework> {
    conn.query_row(&format!("SELECT {HW_SELECT} FROM homework WHERE id=?1"), [id], hw_row)
        .optional()?
        .ok_or_else(|| Error::NotFound(format!("Hausaufgabe {id}")))
}

pub fn set_homework_done(conn: &Connection, id: &str, done: bool) -> Result<Homework> {
    let now = now_ms();
    let n = conn.execute(
        "UPDATE homework SET done_at=?2, updated_at=?3 WHERE id=?1",
        params![id, done.then_some(now), now],
    )?;
    if n == 0 {
        return Err(Error::NotFound(format!("Hausaufgabe {id}")));
    }
    get_homework(conn, id)
}

/// Eigene Aufgaben werden gelöscht, Moodle-Abgaben nur ausgeblendet (sonst kämen sie beim Abgleich zurück).
pub fn delete_homework(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM homework WHERE id=?1 AND source='manual'", [id])?
        + conn.execute("UPDATE homework SET dismissed=1, updated_at=?2 WHERE id=?1 AND source IN ('moodle','webuntis')", params![id, now_ms()])?;
    if n == 0 {
        return Err(Error::NotFound(format!("Hausaufgabe {id}")));
    }
    Ok(())
}

/// Moodle-Abgabe übernehmen bzw. aktualisieren. Erledigt-Status, Notiz und eigenes Fach bleiben erhalten.
pub fn upsert_moodle_homework(
    conn: &Connection,
    moodle_id: i64,
    subject_id: Option<&str>,
    title: &str,
    due: i64,
    url: &str,
) -> Result<String> {
    let id = format!("moodle:{moodle_id}");
    let now = now_ms();
    conn.execute(
        &format!(
            "INSERT INTO homework ({HW_COLS}) VALUES (?1,?2,?3,'',?4,NULL,'moodle',?5,?6,?6)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, due=excluded.due, url=excluded.url,
               subject_id=COALESCE(homework.subject_id, excluded.subject_id),
               updated_at=CASE WHEN homework.title IS excluded.title AND homework.due IS excluded.due
                                AND homework.url IS excluded.url THEN homework.updated_at ELSE excluded.updated_at END"
        ),
        params![id, subject_id, title, due, url, now],
    )?;
    Ok(id)
}

/// Offene, künftige Moodle-Abgaben entfernen, die Moodle nicht mehr meldet.
pub fn prune_moodle_homework(conn: &Connection, now: i64, keep: &[String]) -> Result<usize> {
    let ids: Vec<String> = {
        let mut st = conn.prepare(
            "SELECT id FROM homework WHERE source='moodle' AND done_at IS NULL AND dismissed=0 AND due >= ?1",
        )?;
        let rows = st.query_map([now], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut n = 0;
    for id in ids.iter().filter(|id| !keep.contains(id)) {
        n += conn.execute("DELETE FROM homework WHERE id=?1", [id])?;
    }
    Ok(n)
}

// ---------- Noten ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Grade {
    #[serde(default)]
    pub id: String,
    pub subject_id: String,
    pub kind: String,
    #[serde(default)]
    pub title: String,
    pub value: f64,
    pub weight: f64,
    pub date: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradeConfig {
    pub scale: String,
    /// Anteil schriftlich in Prozent je Fach-ID (fehlt = Standard 50).
    pub written_pct: std::collections::BTreeMap<String, i64>,
}

fn scale(conn: &Connection) -> Result<String> {
    Ok(conn
        .query_row("SELECT scale FROM grade_config WHERE id='*'", [], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten()
        .unwrap_or_else(|| "grades".into()))
}

fn valid_value(scale: &str, v: f64) -> bool {
    v.is_finite() && if scale == "points" { (0.0..=15.0).contains(&v) } else { (1.0..=6.0).contains(&v) }
}

pub fn list_grades(conn: &Connection) -> Result<Vec<Grade>> {
    let mut st = conn.prepare_cached(
        "SELECT id, subject_id, kind, title, value, weight, date FROM grade WHERE status='done' ORDER BY date, created_at",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Grade {
            id: r.get(0)?,
            subject_id: r.get(1)?,
            kind: r.get(2)?,
            title: r.get(3)?,
            value: r.get(4)?,
            weight: r.get(5)?,
            date: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn save_grade(conn: &Connection, mut g: Grade) -> Result<Grade> {
    if g.kind != "written" && g.kind != "oral" {
        return Err(Error::Invalid("Art muss schriftlich oder mündlich sein".into()));
    }
    let sc = scale(conn)?;
    if !valid_value(&sc, g.value) {
        return Err(Error::Invalid(if sc == "points" {
            "Punkte müssen zwischen 0 und 15 liegen".into()
        } else {
            "Note muss zwischen 1 und 6 liegen".into()
        }));
    }
    if !(g.weight.is_finite() && g.weight > 0.0 && g.weight <= 10.0) {
        return Err(Error::Invalid("Gewicht muss größer als 0 und höchstens 10 sein".into()));
    }
    g.title = g.title.trim().into();
    if g.id.is_empty() {
        g.id = new_id();
    }
    conn.execute(
        "INSERT INTO grade (id, subject_id, kind, title, value, weight, date, created_at, status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'done')
         ON CONFLICT(id) DO UPDATE SET subject_id=excluded.subject_id, kind=excluded.kind, title=excluded.title,
           value=excluded.value, weight=excluded.weight, date=excluded.date, status='done'",
        params![g.id, g.subject_id, g.kind, g.title, g.value, g.weight, g.date, now_ms()],
    )?;
    Ok(g)
}

/// Löschen. Automatisch angelegte Einträge (Arbeit geschrieben) werden nur verworfen, damit sie nicht
/// beim nächsten Abgleich wiederkommen.
pub fn delete_grade(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("UPDATE grade SET status='skipped', value=NULL WHERE id=?1 AND exam_key IS NOT NULL", [id])?
        + conn.execute("DELETE FROM grade WHERE id=?1 AND exam_key IS NULL", [id])?;
    if n == 0 {
        return Err(Error::NotFound(format!("Note {id}")));
    }
    Ok(())
}

/// Geschriebene Arbeit, deren Note noch fehlt (Status „Ausstehend“).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingGrade {
    pub id: String,
    pub subject_id: String,
    pub kind: String,
    pub title: String,
    pub date: i64,
}

pub fn list_pending_grades(conn: &Connection) -> Result<Vec<PendingGrade>> {
    let mut st = conn.prepare_cached(
        "SELECT id, subject_id, kind, title, date FROM grade WHERE status='pending' ORDER BY date",
    )?;
    let rows = st.query_map([], |r| {
        Ok(PendingGrade { id: r.get(0)?, subject_id: r.get(1)?, kind: r.get(2)?, title: r.get(3)?, date: r.get(4)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Für jede geschriebene Arbeit/Test (Ende vorbei, Fach zugeordnet, keine Abwesenheit) einen
/// ausstehenden Noteneintrag anlegen. Deterministische ID → keine Dubletten über Geräte hinweg;
/// verworfene oder schon benotete Einträge bleiben, wie sie sind. Nur Arbeiten ab `since`.
pub fn ensure_pending_grades(conn: &Connection, now: i64, since: i64) -> Result<usize> {
    let exams: Vec<(String, String, String, i64)> = {
        let mut st = conn.prepare_cached(
            r#"SELECT COALESCE(e.external_id, 'event:' || e.id), e.subject_id, e.title, e.start FROM event e
               WHERE e.type IN ('exam','test') AND e.subject_id IS NOT NULL
                 AND COALESCE(e."end", e.start + 2700000) <= ?1 AND e.start >= ?2
                 AND NOT EXISTS (SELECT 1 FROM untis_absence a WHERE a.start < COALESCE(e."end", e.start + 2700000) AND a."end" > e.start)"#,
        )?;
        let rows = st.query_map([now, since], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut n = 0;
    for (key, subject, title, date) in exams {
        n += conn.execute(
            "INSERT INTO grade (id, subject_id, kind, title, value, weight, date, created_at, status, exam_key)
             VALUES (?1, ?2, 'written', ?3, NULL, 1, ?4, ?5, 'pending', ?6) ON CONFLICT(id) DO NOTHING",
            params![format!("pending:{key}"), subject, title, date, now, key],
        )?;
    }
    Ok(n)
}

pub fn grade_config(conn: &Connection) -> Result<GradeConfig> {
    let mut st = conn.prepare_cached("SELECT id, written_pct FROM grade_config WHERE id<>'*' AND written_pct IS NOT NULL")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    Ok(GradeConfig { scale: scale(conn)?, written_pct: rows.collect::<rusqlite::Result<_>>()? })
}

pub fn set_subject_weight(conn: &Connection, subject_id: &str, written_pct: i64) -> Result<()> {
    if !(0..=100).contains(&written_pct) {
        return Err(Error::Invalid("Anteil muss zwischen 0 und 100 % liegen".into()));
    }
    conn.execute(
        "INSERT INTO grade_config (id, written_pct) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET written_pct=excluded.written_pct",
        params![subject_id, written_pct],
    )?;
    Ok(())
}

/// Notensystem wechseln. Vorhandene Noten werden umgerechnet (Punkte = 17 − 3·Note, gerundet/geklemmt).
pub fn set_grade_scale(conn: &mut Connection, new_scale: &str) -> Result<()> {
    if new_scale != "grades" && new_scale != "points" {
        return Err(Error::Invalid("Unbekanntes Notensystem".into()));
    }
    let tx = conn.transaction()?;
    let old = scale(&tx)?;
    if old != new_scale {
        let sql = if new_scale == "points" {
            "UPDATE grade SET value = MAX(0, MIN(15, ROUND(17 - 3*value)))"
        } else {
            "UPDATE grade SET value = MAX(1.0, MIN(6.0, ROUND((17 - value)/3.0, 2)))"
        };
        tx.execute(sql, [])?;
        tx.execute(
            "INSERT INTO grade_config (id, scale) VALUES ('*', ?1) ON CONFLICT(id) DO UPDATE SET scale=excluded.scale",
            [new_scale],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{repo, Db};

    fn hw(title: &str, due: Option<i64>) -> Homework {
        Homework {
            id: String::new(), subject_id: None, title: title.into(), note: String::new(), due, done_at: None,
            source: "manual".into(), url: String::new(), created_at: 0, updated_at: 0,
            untis_subject: String::new(), assigned_at: None, teacher: String::new(),
        }
    }

    #[test]
    fn homework_crud_and_order() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        assert!(save_homework(&c, hw("  ", None)).is_err());
        let a = save_homework(&c, hw("Ohne Termin", None)).unwrap();
        let b = save_homework(&c, hw("Später", Some(2000))).unwrap();
        let d = save_homework(&c, hw("Bald", Some(1000))).unwrap();
        let ids = |v: Vec<Homework>| v.into_iter().map(|h| h.title).collect::<Vec<_>>();
        assert_eq!(ids(list_homework(&c, 0).unwrap()), ["Bald", "Später", "Ohne Termin"]);
        let done = set_homework_done(&c, &d.id, true).unwrap();
        assert!(done.done_at.is_some());
        assert_eq!(ids(list_homework(&c, 0).unwrap()), ["Später", "Ohne Termin", "Bald"]);
        assert_eq!(list_homework(&c, i64::MAX).unwrap().len(), 2, "alte Erledigte ausgeblendet");
        let mut e = b.clone();
        e.title = "Später!".into();
        assert_eq!(save_homework(&c, e).unwrap().title, "Später!");
        delete_homework(&c, &a.id).unwrap();
        assert!(get_homework(&c, &a.id).is_err());
        // Fach löschen → Aufgabe bleibt ohne Fach
        let s = repo::create_subject(&c, "Mathe", "#f00", "sigma").unwrap();
        let mut f = hw("Mit Fach", None);
        f.subject_id = Some(s.id.clone());
        let f = save_homework(&c, f).unwrap();
        repo::delete_subject(&c, &s.id).unwrap();
        assert_eq!(get_homework(&c, &f.id).unwrap().subject_id, None);
    }

    #[test]
    fn moodle_homework_keeps_user_state() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        let id = upsert_moodle_homework(&c, 7, None, "Abgabe", 5000, "https://m/7").unwrap();
        assert_eq!(id, "moodle:7");
        let mut h = get_homework(&c, &id).unwrap();
        h.note = "schon angefangen".into();
        h.title = "eigener Titel".into();
        h.done_at = Some(1);
        save_homework(&c, h).unwrap();
        upsert_moodle_homework(&c, 7, None, "Abgabe neu", 6000, "https://m/7").unwrap();
        let h = get_homework(&c, &id).unwrap();
        assert_eq!((h.title.as_str(), h.due, h.note.as_str(), h.done_at), ("Abgabe neu", Some(6000), "schon angefangen", Some(1)));
        // Ausblenden statt Löschen; Abgleich bringt sie nicht zurück
        delete_homework(&c, &id).unwrap();
        upsert_moodle_homework(&c, 7, None, "Abgabe neu", 6000, "").unwrap();
        assert!(list_homework(&c, 0).unwrap().is_empty());
        // Entfallene offene Abgaben werden entfernt, erledigte bleiben
        upsert_moodle_homework(&c, 8, None, "weg", 9000, "").unwrap();
        upsert_moodle_homework(&c, 9, None, "bleibt", 9000, "").unwrap();
        assert_eq!(prune_moodle_homework(&c, 0, &["moodle:9".into()]).unwrap(), 1);
        assert!(get_homework(&c, "moodle:8").is_err());
        let mut fake = hw("x", None);
        fake.id = "neu".into();
        fake.source = "moodle".into();
        assert!(save_homework(&c, fake).is_err());
    }

    #[test]
    fn grades_validation_scale_and_weights() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        let s = repo::create_subject(&c, "Mathe", "#f00", "sigma").unwrap();
        let g = |v: f64| Grade { id: String::new(), subject_id: s.id.clone(), kind: "written".into(), title: "KA".into(), value: v, weight: 1.0, date: 1 };
        assert!(save_grade(&c, g(0.5)).is_err());
        assert!(save_grade(&c, g(7.0)).is_err());
        let a = save_grade(&c, g(2.0)).unwrap();
        assert!(save_grade(&c, Grade { weight: 0.0, ..g(2.0) }).is_err());
        assert!(save_grade(&c, Grade { kind: "x".into(), ..g(2.0) }).is_err());
        set_subject_weight(&c, &s.id, 60).unwrap();
        assert!(set_subject_weight(&c, &s.id, 101).is_err());
        assert_eq!(grade_config(&c).unwrap().written_pct.get(&s.id), Some(&60));
        set_grade_scale(&mut c, "points").unwrap();
        assert_eq!(grade_config(&c).unwrap().scale, "points");
        assert_eq!(list_grades(&c).unwrap()[0].value, 11.0);
        assert!(save_grade(&c, g(15.0)).is_ok());
        set_grade_scale(&mut c, "grades").unwrap();
        assert_eq!(list_grades(&c).unwrap().iter().find(|x| x.id == a.id).unwrap().value, 2.0);
        delete_grade(&c, &a.id).unwrap();
        // Geschriebene Arbeit → „Ausstehend“, nicht bei Abwesenheit, nicht doppelt, verwerfen bleibt verworfen
        let ev = |t: &str, start: i64| crate::db::models::Event {
            id: String::new(), subject_id: Some(s.id.clone()), kind: "exam".into(), title: t.into(), start, end: Some(start + 10),
            note: String::new(), source: "manual".into(), remind_before: None, page_id: None, updated_at: 0,
        };
        let ka = repo::save_event(&c, ev("KA 1", 100)).unwrap();
        repo::save_event(&c, ev("KA krank", 300)).unwrap();
        repo::save_event(&c, ev("KA Zukunft", 10_000)).unwrap();
        repo::save_event(&c, ev("KA alt", 5)).unwrap();
        c.execute("INSERT INTO untis_absence (id, start, \"end\") VALUES (1, 290, 400)", []).unwrap();
        assert_eq!(ensure_pending_grades(&c, 1000, 50).unwrap(), 1);
        assert_eq!(ensure_pending_grades(&c, 1000, 50).unwrap(), 0);
        let p = list_pending_grades(&c).unwrap();
        assert_eq!((p.len(), p[0].title.as_str(), p[0].id.clone()), (1, "KA 1", format!("pending:event:{}", ka.id)));
        assert!(list_grades(&c).unwrap().iter().all(|g| g.id != p[0].id), "Ausstehende zählen nicht in den Schnitt");
        // Note eintragen → normaler Eintrag
        save_grade(&c, Grade { id: p[0].id.clone(), ..g(2.0) }).unwrap();
        assert!(list_pending_grades(&c).unwrap().is_empty());
        assert!(list_grades(&c).unwrap().iter().any(|x| x.id == p[0].id));
        // Löschen eines automatischen Eintrags verwirft ihn dauerhaft
        delete_grade(&c, &p[0].id).unwrap();
        assert_eq!(ensure_pending_grades(&c, 1000, 50).unwrap(), 0);
        assert!(list_grades(&c).unwrap().iter().all(|x| x.id != p[0].id));
        repo::delete_subject(&c, &s.id).unwrap();
        assert!(list_grades(&c).unwrap().is_empty());
        assert!(grade_config(&c).unwrap().written_pct.is_empty());
    }
}
