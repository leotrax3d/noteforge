//! Phase 6: WebUntis + Moodle BW (SPEC §8).
//! Konfiguration (Server, Schule, Benutzername) in SQLite, Passwort/Token nur im Credential Manager.

pub mod google;
pub mod moodle;
pub mod secrets;
pub mod webuntis;

use crate::db::{repo::new_id, Db};
use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};
use moodle::{MoodleConfig, MoodleCourse, MoodleFile};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use webuntis::UntisConfig;

#[derive(Debug, thiserror::Error)]
pub enum IntErr {
    #[error("{0}")]
    Auth(String),
    #[error("{0}")]
    Remote(String),
    #[error("Keine Verbindung: {0}")]
    Net(#[from] reqwest::Error),
    #[error(transparent)]
    Db(#[from] crate::db::Error),
    #[error("Datenbankfehler: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for IntErr {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type R<T> = Result<T, IntErr>;

/// Ortszeit → ms seit Epoche.
pub fn local_ms(y: i32, m: u32, d: u32, h: u32, min: u32) -> Option<i64> {
    let naive = NaiveDate::from_ymd_opt(y, m, d)?.and_hms_opt(h, min, 0)?;
    Local.from_local_datetime(&naive).earliest().map(|t| t.timestamp_millis())
}

fn yyyymmdd(d: NaiveDate) -> i64 {
    (d.year() as i64) * 10000 + (d.month() as i64) * 100 + d.day() as i64
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

// ---------- Einstellungen ----------

pub(crate) fn get_setting<T: serde::de::DeserializeOwned>(conn: &Connection, key: &str) -> R<Option<T>> {
    let v: Option<String> =
        conn.query_row("SELECT value FROM setting WHERE key=?1", [key], |r| r.get(0)).optional()?;
    Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
}

pub(crate) fn set_setting<T: Serialize>(conn: &Connection, key: &str, v: &T) -> R<()> {
    let json = serde_json::to_string(v).map_err(|e| IntErr::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, json],
    )?;
    Ok(())
}

fn del_setting(conn: &Connection, key: &str) -> R<()> {
    conn.execute("DELETE FROM setting WHERE key=?1", [key])?;
    Ok(())
}

// ---------- Stundenplan-Cache ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: i64,
    pub start: i64,
    pub end: i64,
    pub untis_subject_id: Option<i64>,
    pub subject_name: String,
    pub subject_long: String,
    pub rooms: String,
    pub teachers: String,
    pub state: String,
    pub info: String,
    /// Über das Fach-Mapping zugeordnetes Noteforge-Fach.
    pub subject_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UntisSubject {
    pub id: i64,
    pub name: String,
    pub long_name: String,
}

pub fn store_lessons(conn: &mut Connection, from: i64, to: i64, ps: &[webuntis::Period]) -> R<usize> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM lesson WHERE start >= ?1 AND start < ?2", [from, to])?;
    {
        let mut ins = tx.prepare_cached(
            r#"INSERT OR REPLACE INTO lesson (id, start, "end", untis_subject_id, subject_name, subject_long,
               rooms, teachers, state, info) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"#,
        )?;
        for p in ps.iter().filter(|p| p.start >= from && p.start < to) {
            ins.execute(params![
                p.id, p.start, p.end, p.subject_id, p.subject_name, p.subject_long, p.rooms, p.teachers, p.state, p.info
            ])?;
        }
    }
    tx.commit()?;
    Ok(ps.len())
}

pub fn list_lessons_db(conn: &Connection, from: i64, to: i64) -> R<Vec<Lesson>> {
    let mut stmt = conn.prepare_cached(
        r#"SELECT l.id, l.start, l."end", l.untis_subject_id, l.subject_name, l.subject_long, l.rooms,
                  l.teachers, l.state, l.info,
                  (SELECT s.id FROM subject s WHERE s.webuntis_subject_id = l.untis_subject_id
                     AND l.untis_subject_id IS NOT NULL ORDER BY s.sort_order LIMIT 1)
           FROM lesson l WHERE l.start < ?2 AND l."end" > ?1 ORDER BY l.start, l.id"#,
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(Lesson {
            id: r.get(0)?,
            start: r.get(1)?,
            end: r.get(2)?,
            untis_subject_id: r.get(3)?,
            subject_name: r.get(4)?,
            subject_long: r.get(5)?,
            rooms: r.get(6)?,
            teachers: r.get(7)?,
            state: r.get(8)?,
            info: r.get(9)?,
            subject_id: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn untis_subjects_db(conn: &Connection) -> R<Vec<UntisSubject>> {
    let mut stmt = conn.prepare_cached(
        "SELECT untis_subject_id, MAX(subject_name), MAX(subject_long) FROM lesson
         WHERE untis_subject_id IS NOT NULL GROUP BY untis_subject_id ORDER BY MAX(subject_long), MAX(subject_name)",
    )?;
    let rows = stmt.query_map([], |r| Ok(UntisSubject { id: r.get(0)?, name: r.get(1)?, long_name: r.get(2)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------- Moodle-Abgaben → Termine ----------

/// Gleicht Moodle-Abgaben mit der Termin-Tabelle ab. Eigene Änderungen an Notiz/Erinnerung bleiben erhalten;
/// zukünftige Moodle-Termine, die es nicht mehr gibt, werden entfernt.
pub fn store_moodle_events(conn: &mut Connection, now: i64, evs: &[moodle::ActionEvent]) -> R<usize> {
    let tx = conn.transaction()?;
    let mut keep = Vec::with_capacity(evs.len());
    let mut hw_keep = Vec::with_capacity(evs.len());
    for e in evs {
        let ext = format!("moodle:{}", e.id);
        let subject: Option<String> = match e.course_id {
            Some(c) => tx
                .query_row(
                    "SELECT id FROM subject WHERE moodle_course_id=?1 ORDER BY sort_order LIMIT 1",
                    [c],
                    |r| r.get(0),
                )
                .optional()?,
            None => None,
        };
        let note = [e.course_name.as_str(), e.url.as_str()]
            .iter()
            .filter(|s| !s.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        tx.execute(
            r#"INSERT INTO event (id, subject_id, type, title, start, "end", note, source, remind_before, external_id)
               VALUES (?1, ?2, 'deadline', ?3, ?4, NULL, ?5, 'moodle', 1440, ?6)
               ON CONFLICT(external_id) WHERE external_id IS NOT NULL DO UPDATE SET
                 title=excluded.title,
                 subject_id=COALESCE(excluded.subject_id, event.subject_id),
                 notified = CASE WHEN event.start=excluded.start THEN event.notified ELSE 0 END,
                 start=excluded.start"#,
            params![new_id(), subject, e.name, e.time, note, ext],
        )?;
        keep.push(ext);
        hw_keep.push(crate::db::school::upsert_moodle_homework(&tx, e.id, subject.as_deref(), &e.name, e.time, &e.url)?);
    }
    crate::db::school::prune_moodle_homework(&tx, now, &hw_keep)?;
    let existing: Vec<String> = {
        let mut st = tx.prepare(
            "SELECT external_id FROM event WHERE source='moodle' AND external_id IS NOT NULL AND start >= ?1",
        )?;
        let rows = st.query_map([now], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for ext in existing.iter().filter(|x| !keep.contains(x)) {
        tx.execute("DELETE FROM event WHERE external_id=?1", [ext])?;
    }
    tx.commit()?;
    Ok(evs.len())
}

// ---------- Commands ----------

type S<'a> = State<'a, Db>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    pub untis: Option<UntisConfig>,
    pub moodle: Option<MoodleConfig>,
    pub untis_last_sync: Option<i64>,
    pub moodle_last_sync: Option<i64>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub lessons: Option<usize>,
    pub deadlines: Option<usize>,
    pub errors: Vec<String>,
    pub skipped: bool,
}

const MIN_SYNC_INTERVAL_MS: i64 = 15 * 60_000;

#[tauri::command]
pub fn integration_status(db: S) -> R<IntegrationStatus> {
    let c = db.conn();
    Ok(IntegrationStatus {
        untis: get_setting(&c, "untis")?,
        moodle: get_setting(&c, "moodle")?,
        untis_last_sync: get_setting(&c, "untis_last_sync")?,
        moodle_last_sync: get_setting(&c, "moodle_last_sync")?,
    })
}

/// Zeitraum des Stundenplan-Abgleichs: Montag der Vorwoche bis +5 Wochen.
fn untis_range() -> (NaiveDate, NaiveDate) {
    let today = Local::now().date_naive();
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64) - Duration::days(7);
    (monday, monday + Duration::days(7 * 6 - 1))
}

fn day_start_ms(d: NaiveDate) -> i64 {
    local_ms(d.year(), d.month(), d.day(), 0, 0).unwrap_or(0)
}

/// Beginn des laufenden Schuljahres (1. August).
fn schoolyear_start() -> NaiveDate {
    let t = Local::now().date_naive();
    let y = if t.month() >= 8 { t.year() } else { t.year() - 1 };
    NaiveDate::from_ymd_opt(y, 8, 1).unwrap_or(t)
}

/// Stundenplan abgleichen. Vergangene Tage bleiben im Cache und werden nie gelöscht; beim ersten
/// Abgleich wird das laufende Schuljahr nachgeladen (in 4-Wochen-Stücken).
async fn sync_untis(db: &Db, cfg: &UntisConfig, password: &str) -> R<usize> {
    let s = webuntis::Session::login(cfg, password).await?;
    let (a, b) = untis_range();
    let backfilled: Option<bool> = get_setting(&db.conn(), "untis_history")?;
    let mut ranges = Vec::new();
    if backfilled != Some(true) {
        let mut d = schoolyear_start();
        while d < a {
            let e = (d + Duration::days(27)).min(a - Duration::days(1));
            ranges.push((d, e));
            d = e + Duration::days(1);
        }
    }
    ranges.push((a, b));
    let mut n = 0;
    let mut err = None;
    for (from, to) in &ranges {
        match s.timetable(yyyymmdd(*from), yyyymmdd(*to)).await {
            Ok(ps) => n += store_lessons(&mut db.conn(), day_start_ms(*from), day_start_ms(*to + Duration::days(1)), &ps)?,
            Err(e) => { err = Some(e); break; }
        }
    }
    s.logout().await;
    if let Some(e) = err {
        return Err(e);
    }
    set_setting(&db.conn(), "untis_history", &true)?;
    set_setting(&db.conn(), "untis_last_sync", &now_ms())?;
    Ok(n)
}

async fn sync_moodle(db: &Db, cfg: &MoodleConfig, token: &str) -> R<usize> {
    let c = moodle::Client::new(&cfg.url, token)?;
    let from = (now_ms() - 7 * 86_400_000) / 1000;
    let evs = c.action_events(from).await?;
    let n = store_moodle_events(&mut db.conn(), now_ms(), &evs)?;
    set_setting(&db.conn(), "moodle_last_sync", &now_ms())?;
    Ok(n)
}

#[tauri::command]
pub async fn untis_connect(db: S<'_>, server: String, school: String, username: String, password: String) -> R<SyncReport> {
    let cfg = UntisConfig {
        server: webuntis::normalize_server(&server),
        school: school.trim().into(),
        username: username.trim().into(),
    };
    if cfg.server.is_empty() || cfg.school.is_empty() || cfg.username.is_empty() || password.is_empty() {
        return Err(IntErr::Other("Bitte Server, Schule, Benutzername und Passwort angeben".into()));
    }
    // Erst prüfen, dann speichern
    let n = sync_untis(&db, &cfg, &password).await?;
    secrets::set(secrets::UNTIS, &password).map_err(IntErr::Other)?;
    set_setting(&db.conn(), "untis", &cfg)?;
    Ok(SyncReport { lessons: Some(n), ..Default::default() })
}

#[tauri::command]
pub fn untis_disconnect(db: S) -> R<()> {
    secrets::delete(secrets::UNTIS).map_err(IntErr::Other)?;
    let c = db.conn();
    del_setting(&c, "untis")?;
    del_setting(&c, "untis_last_sync")?;
    del_setting(&c, "untis_history")?;
    c.execute("DELETE FROM lesson", [])?;
    Ok(())
}

/// Verbindet Moodle mit Passwort (→ Token) oder direkt mit einem Token (z. B. bei SSO-Konten).
#[tauri::command]
pub async fn moodle_connect(db: S<'_>, url: String, username: String, password: String, token: Option<String>) -> R<SyncReport> {
    let cfg = MoodleConfig { url: moodle::normalize_url(&url), username: username.trim().into() };
    let token = match token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(t) => t,
        None => {
            if cfg.username.is_empty() || password.is_empty() {
                return Err(IntErr::Other("Bitte Benutzername und Passwort (oder ein Token) angeben".into()));
            }
            moodle::fetch_token(&cfg.url, &cfg.username, &password).await?
        }
    };
    moodle::Client::new(&cfg.url, &token)?.user_id().await?;
    let n = sync_moodle(&db, &cfg, &token).await?;
    // Nur das Token wird gespeichert, nie das Passwort.
    secrets::set(secrets::MOODLE, &token).map_err(IntErr::Other)?;
    set_setting(&db.conn(), "moodle", &cfg)?;
    Ok(SyncReport { deadlines: Some(n), ..Default::default() })
}

#[tauri::command]
pub fn moodle_disconnect(db: S) -> R<()> {
    secrets::delete(secrets::MOODLE).map_err(IntErr::Other)?;
    let c = db.conn();
    del_setting(&c, "moodle")?;
    del_setting(&c, "moodle_last_sync")?;
    Ok(())
}

fn moodle_client(db: &Db) -> R<moodle::Client> {
    let cfg: MoodleConfig =
        get_setting(&db.conn(), "moodle")?.ok_or_else(|| IntErr::Other("Moodle ist nicht verbunden".into()))?;
    let token = secrets::get(secrets::MOODLE)
        .map_err(IntErr::Other)?
        .ok_or_else(|| IntErr::Auth("Moodle: Anmeldung fehlt – bitte neu verbinden".into()))?;
    moodle::Client::new(&cfg.url, &token)
}

/// Abgleich beider Dienste; ohne `force` höchstens alle 15 Minuten.
#[tauri::command]
pub async fn integrations_sync(db: S<'_>, force: bool) -> R<SyncReport> {
    let (untis, moodle_cfg, lu, lm): (Option<UntisConfig>, Option<MoodleConfig>, Option<i64>, Option<i64>) = {
        let c = db.conn();
        (get_setting(&c, "untis")?, get_setting(&c, "moodle")?, get_setting(&c, "untis_last_sync")?, get_setting(&c, "moodle_last_sync")?)
    };
    let due = |last: Option<i64>| force || last.is_none_or(|t| now_ms() - t >= MIN_SYNC_INTERVAL_MS);
    let mut rep = SyncReport::default();
    let mut ran = false;
    if let Some(cfg) = untis.filter(|_| due(lu)) {
        ran = true;
        let r = match secrets::get(secrets::UNTIS) {
            Ok(Some(pw)) => sync_untis(&db, &cfg, &pw).await,
            Ok(None) => Err(IntErr::Auth("WebUntis: Passwort fehlt – bitte neu verbinden".into())),
            Err(e) => Err(IntErr::Other(e)),
        };
        match r {
            Ok(n) => rep.lessons = Some(n),
            Err(e) => rep.errors.push(e.to_string()),
        }
    }
    if let Some(cfg) = moodle_cfg.filter(|_| due(lm)) {
        ran = true;
        let r = match secrets::get(secrets::MOODLE) {
            Ok(Some(t)) => sync_moodle(&db, &cfg, &t).await,
            Ok(None) => Err(IntErr::Auth("Moodle: Anmeldung fehlt – bitte neu verbinden".into())),
            Err(e) => Err(IntErr::Other(e)),
        };
        match r {
            Ok(n) => rep.deadlines = Some(n),
            Err(e) => rep.errors.push(e.to_string()),
        }
    }
    rep.skipped = !ran;
    Ok(rep)
}

#[tauri::command]
pub fn list_lessons(db: S, from: i64, to: i64) -> R<Vec<Lesson>> {
    list_lessons_db(&db.conn(), from, to)
}

#[tauri::command]
pub fn list_untis_subjects(db: S) -> R<Vec<UntisSubject>> {
    untis_subjects_db(&db.conn())
}

#[tauri::command]
pub async fn moodle_courses(db: S<'_>) -> R<Vec<MoodleCourse>> {
    let c = moodle_client(&db)?;
    c.courses().await
}

#[tauri::command]
pub async fn moodle_course_files(db: S<'_>, course_id: i64) -> R<Vec<MoodleFile>> {
    let c = moodle_client(&db)?;
    c.files(course_id).await
}

/// PDF aus Moodle als Rohbytes (Import erfolgt im Frontend wie bei lokalen PDFs).
#[tauri::command]
pub async fn moodle_download(db: S<'_>, fileurl: String) -> R<tauri::ipc::Response> {
    let c = moodle_client(&db)?;
    Ok(tauri::ipc::Response::new(c.download(&fileurl).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo;

    fn period(id: i64, start: i64, subject: Option<i64>) -> webuntis::Period {
        webuntis::Period {
            id, start, end: start + 45, subject_id: subject, subject_name: "M".into(), subject_long: "Mathematik".into(),
            rooms: String::new(), teachers: String::new(), state: "normal", info: String::new(),
        }
    }

    #[test]
    fn lessons_cache_replaces_range_and_maps_subjects() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        let s = repo::create_subject(&c, "Mathe", "#f00", "calc").unwrap();
        c.execute("UPDATE subject SET webuntis_subject_id=7 WHERE id=?1", [&s.id]).unwrap();
        store_lessons(&mut c, 0, 1000, &[period(1, 100, Some(7)), period(2, 200, Some(8)), period(3, 5000, None)]).unwrap();
        let l = list_lessons_db(&c, 0, 1000).unwrap();
        assert_eq!(l.len(), 2, "außerhalb des Zeitraums wird nicht gespeichert");
        assert_eq!(l[0].subject_id.as_deref(), Some(s.id.as_str()));
        assert_eq!(l[1].subject_id, None);
        store_lessons(&mut c, 0, 1000, &[period(2, 200, Some(8))]).unwrap();
        assert_eq!(list_lessons_db(&c, 0, 1000).unwrap().len(), 1, "Abgleich ersetzt den Zeitraum");
        assert_eq!(untis_subjects_db(&c).unwrap(), vec![UntisSubject { id: 8, name: "M".into(), long_name: "Mathematik".into() }]);
    }

    #[test]
    fn moodle_events_upsert_and_prune() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        let s = repo::create_subject(&c, "Physik", "#00f", "atom").unwrap();
        c.execute("UPDATE subject SET moodle_course_id=5 WHERE id=?1", [&s.id]).unwrap();
        let ev = |id, time| moodle::ActionEvent {
            id, name: format!("Aufgabe {id}"), course_id: Some(5), course_name: "Physik 10".into(), time, url: String::new(),
        };
        store_moodle_events(&mut c, 0, &[ev(1, 10_000), ev(2, 20_000)]).unwrap();
        let all = repo::list_events(&c, 0, i64::MAX).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|e| e.kind == "deadline" && e.source == "moodle" && e.subject_id.as_deref() == Some(s.id.as_str())));
        // Nutzer ändert die Notiz, Moodle verschiebt die Frist, Abgabe 2 entfällt
        let mut e1 = all[0].clone();
        e1.note = "eigene Notiz".into();
        repo::save_event(&c, e1).unwrap();
        store_moodle_events(&mut c, 0, &[ev(1, 15_000)]).unwrap();
        let all = repo::list_events(&c, 0, i64::MAX).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!((all[0].start, all[0].note.as_str()), (15_000, "eigene Notiz"));
        assert_eq!(all[0].remind_before, Some(1440));
        // Abgaben landen auch in der Hausaufgaben-Liste (Abgabe 2 entfiel)
        let hw = crate::db::school::list_homework(&c, 0).unwrap();
        assert_eq!(hw.len(), 1);
        assert_eq!((hw[0].id.as_str(), hw[0].due, hw[0].subject_id.as_deref()), ("moodle:1", Some(15_000), Some(s.id.as_str())));
    }
}
