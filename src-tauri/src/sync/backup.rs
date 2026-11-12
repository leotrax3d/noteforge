//! Automatische Sicherungen (SPEC §10.1): täglich per `VACUUM INTO` (konsistent auch während die App
//! läuft) in einen wählbaren Ordner; Aufbewahrung nach Großvater-Vater-Sohn (z. B. 7 tägliche,
//! 4 wöchentliche, 6 monatliche). Wiederherstellen komplett oder nur einzelne Fächer/Blätter.

use crate::db::{Db, Error, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PREFIX: &str = "noteforge-";
const EXT: &str = ".sqlite";
pub const CONFIG_KEY: &str = "app.backup";
/// Vor jeder Wiederherstellung wird der aktuelle Stand so gesichert (nie automatisch gelöscht).
const SAFETY: &str = "noteforge-vor-wiederherstellung-";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupConfig {
    /// Zielordner; None = `<App-Daten>/backups`
    pub dir: Option<String>,
    pub daily: usize,
    pub weekly: usize,
    pub monthly: usize,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self { dir: None, daily: 7, weekly: 4, monthly: 6 }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created: i64,
}

pub fn config(conn: &Connection) -> BackupConfig {
    conn.query_row("SELECT value FROM setting WHERE key=?1", [CONFIG_KEY], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn set_config(conn: &Connection, c: &BackupConfig) -> Result<()> {
    if c.daily == 0 {
        return Err(Error::Invalid("Mindestens eine tägliche Sicherung behalten".into()));
    }
    if let Some(d) = &c.dir {
        let chk = crate::onboarding::check_dir(Path::new(d));
        if !chk.writable {
            return Err(Error::Invalid("Sicherungsordner ist nicht beschreibbar".into()));
        }
    }
    conn.execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![CONFIG_KEY, serde_json::to_string(c)?],
    )?;
    Ok(())
}

pub fn default_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::onboarding::data_dir(app).ok().or_else(|| app.path().app_data_dir().ok()).map(|d| d.join("backups"))
}

pub fn dir(app: &AppHandle, conn: &Connection) -> Option<PathBuf> {
    config(conn).dir.map(PathBuf::from).or_else(|| default_dir(app))
}

pub fn list(dir: &Path) -> Vec<BackupInfo> {
    let mut v: Vec<BackupInfo> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !(name.starts_with(PREFIX) && name.ends_with(EXT)) {
                return None;
            }
            let m = e.metadata().ok()?;
            let created = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Some(BackupInfo { name, size: m.len(), created })
        })
        .collect();
    // Namen enthalten Datum/Uhrzeit → lexikografisch = chronologisch
    v.sort_by(|a, b| b.name.cmp(&a.name));
    v
}

fn date_of(name: &str) -> Option<chrono::NaiveDate> {
    let d = name.strip_prefix(PREFIX)?.get(..10)?;
    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
}

/// Welche Sicherungen behalten werden (Namen, neueste zuerst). Je Tag/Woche/Monat zählt die neueste.
pub fn retained(names: &[String], c: &BackupConfig) -> HashSet<String> {
    use chrono::Datelike;
    let mut sorted: Vec<&String> = names.iter().filter(|n| date_of(n).is_some()).collect();
    sorted.sort_by(|a, b| b.cmp(a));
    let mut keep = HashSet::new();
    let mut pick = |key: &dyn Fn(chrono::NaiveDate) -> String, n: usize| {
        let mut seen = BTreeSet::new();
        for name in &sorted {
            if seen.len() >= n {
                break;
            }
            let k = key(date_of(name).unwrap());
            if seen.insert(k) {
                keep.insert((*name).clone());
            }
        }
    };
    pick(&|d| d.to_string(), c.daily);
    pick(&|d| format!("{}-W{}", d.iso_week().year(), d.iso_week().week()), c.weekly);
    pick(&|d| format!("{}-{}", d.year(), d.month()), c.monthly);
    // Sicherheitskopien vor Wiederherstellungen bleiben
    for n in names {
        if n.starts_with(SAFETY) {
            keep.insert(n.clone());
        }
    }
    keep
}

fn prune(dir: &Path, c: &BackupConfig) {
    let names: Vec<String> = list(dir).into_iter().map(|b| b.name).collect();
    let keep = retained(&names, c);
    for n in names {
        if !keep.contains(&n) {
            let _ = std::fs::remove_file(dir.join(n));
        }
    }
}

fn vacuum_into(db: &Db, dir: &Path, name: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    let _ = std::fs::remove_file(&tmp);
    db.conn().execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()]).map_err(Error::from)?;
    std::fs::rename(&tmp, &path)?;
    Ok(path)
}

/// Legt die Sicherung für heute an (`force`: zusätzlich eine mit Uhrzeit). Liefert den Pfad, falls neu.
pub fn create(db: &Db, dir: &Path, force: bool) -> Result<Option<PathBuf>> {
    let cfg = config(&db.conn());
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let exists = list(dir).iter().any(|b| b.name.starts_with(&format!("{PREFIX}{today}")));
    if exists && !force {
        return Ok(None);
    }
    let name = if exists {
        format!("{PREFIX}{today}-{}{EXT}", chrono::Local::now().format("%H%M%S"))
    } else {
        format!("{PREFIX}{today}{EXT}")
    };
    let path = vacuum_into(db, dir, &name)?;
    prune(dir, &cfg);
    Ok(Some(path))
}

fn backup_path(dir: &Path, name: &str) -> Result<PathBuf> {
    if !name.starts_with(PREFIX) || !name.ends_with(EXT) || name.contains(['/', '\\']) || name.contains("..") {
        return Err(Error::Invalid("Unbekannte Sicherung".into()));
    }
    let p = dir.join(name);
    if !p.is_file() {
        return Err(Error::NotFound(format!("Sicherung {name}")));
    }
    Ok(p)
}

/// Kopie der Sicherung öffnen und auf das aktuelle Schema migrieren (ältere Sicherungen).
fn open_copy(src: &Path) -> Result<(PathBuf, Db)> {
    let tmp = std::env::temp_dir().join(format!("noteforge-restore-{}.sqlite", uuid::Uuid::new_v4()));
    std::fs::copy(src, &tmp)?;
    let db = Db::open(&tmp)?;
    Ok((tmp, db))
}

// ---------- Vorschau ----------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPage {
    pub id: String,
    pub title: String,
    pub elements: i64,
    pub updated_at: i64,
    /// Stand im aktuellen Datenbestand: "same" | "changed" | "missing"
    pub current: String,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSection { pub id: String, pub name: String, pub pages: Vec<PreviewPage> }
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSubject { pub id: String, pub name: String, pub color: String, pub sections: Vec<PreviewSection> }

pub fn preview(live: &Connection, backup: &Connection) -> Result<Vec<PreviewSubject>> {
    let mut out = Vec::new();
    let mut st = backup.prepare("SELECT id, name, color FROM subject ORDER BY sort_order")?;
    let subjects: Vec<(String, String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    for (sid, name, color) in subjects {
        let mut secs = Vec::new();
        let mut st = backup.prepare("SELECT id, name FROM section WHERE subject_id=?1 ORDER BY sort_order")?;
        let sections: Vec<(String, String)> = st.query_map([&sid], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        for (secid, secname) in sections {
            let mut st = backup.prepare(
                "SELECT p.id, p.title, p.updated_at, (SELECT count(*) FROM element e WHERE e.page_id=p.id)
                 FROM page p WHERE p.section_id=?1 AND p.deleted_at IS NULL ORDER BY p.sort_order",
            )?;
            let pages = st
                .query_map([&secid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .map(|(id, title, updated_at, elements)| {
                    let cur: Option<i64> = live.query_row("SELECT updated_at FROM page WHERE id=?1 AND deleted_at IS NULL", [&id], |r| r.get(0)).optional().ok().flatten();
                    let current = match cur { None => "missing", Some(u) if u == updated_at => "same", _ => "changed" }.into();
                    PreviewPage { id, title, elements, updated_at, current }
                })
                .collect();
            secs.push(PreviewSection { id: secid, name: secname, pages });
        }
        out.push(PreviewSubject { id: sid, name, color, sections: secs });
    }
    Ok(out)
}

// ---------- Wiederherstellen ----------

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RestoreScope {
    /// Alles (außer gerätebezogenen Einstellungen und Sync-Zustand)
    pub all: bool,
    pub subjects: Vec<String>,
    pub pages: Vec<String>,
}

/// Tabellen, die bei „komplett“ nicht ersetzt werden (Gerät, Zugangsdaten-Verweise, Sync-Zustand).
const KEEP_TABLES: &[&str] = &["setting", "sync_page", "sync_meta"];

fn tables(conn: &Connection) -> Result<Vec<String>> {
    let mut st = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'page_fts%' ORDER BY name",
    )?;
    Ok(st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
}

fn columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare(&format!("PRAGMA main.table_info({table})"))?;
    Ok(st.query_map([], |r| r.get::<_, String>(1))?.collect::<rusqlite::Result<_>>()?)
}

/// Zeilen aus `b.<table>` übernehmen (Upsert über `id`, sonst INSERT OR REPLACE).
fn copy_rows(conn: &Connection, table: &str, filter: &str, args: &[&dyn rusqlite::ToSql]) -> Result<usize> {
    let cols = columns(conn, table)?;
    let list = cols.join(", ");
    let sql = if cols.iter().any(|c| c == "id") {
        let set = cols.iter().filter(|c| *c != "id").map(|c| format!("{c}=excluded.{c}")).collect::<Vec<_>>().join(", ");
        format!("INSERT INTO main.{table} ({list}) SELECT {list} FROM b.{table} WHERE {filter} ON CONFLICT(id) DO UPDATE SET {set}")
    } else {
        format!("INSERT OR REPLACE INTO main.{table} ({list}) SELECT {list} FROM b.{table} WHERE {filter}")
    };
    Ok(conn.execute(&sql, args)?)
}

/// Stellt aus `backup_file` (bereits migrierte Kopie) wieder her; liefert die Anzahl der Blätter.
pub fn restore(conn: &mut Connection, backup_file: &Path, scope: &RestoreScope) -> Result<usize> {
    conn.execute("ATTACH DATABASE ?1 AS b", [backup_file.to_string_lossy().as_ref()])?;
    let res = (|| -> Result<usize> {
        conn.pragma_update(None, "foreign_keys", false)?;
        let tx = conn.transaction()?;
        let pages: Vec<String> = if scope.all {
            for t in tables(&tx)? {
                if KEEP_TABLES.contains(&t.as_str()) {
                    continue;
                }
                tx.execute(&format!("DELETE FROM main.{t}"), [])?;
                let cols = columns(&tx, &t)?.join(", ");
                tx.execute(&format!("INSERT INTO main.{t} ({cols}) SELECT {cols} FROM b.{t}"), [])?;
            }
            let mut st = tx.prepare("SELECT id FROM page")?;
            st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
        } else {
            let mut want: BTreeSet<String> = scope.pages.iter().cloned().collect();
            for s in &scope.subjects {
                copy_rows(&tx, "subject", "id=?1", &[s])?;
                let mut st = tx.prepare("SELECT p.id FROM b.page p JOIN b.section x ON x.id=p.section_id WHERE x.subject_id=?1")?;
                want.extend(st.query_map([s], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?);
                copy_rows(&tx, "section", "subject_id=?1", &[s])?;
            }
            copy_rows(&tx, "tag", "1", &[])?;
            for p in &want {
                // Fach und Thema des Blatts müssen existieren
                copy_rows(&tx, "subject", "id=(SELECT x.subject_id FROM b.section x JOIN b.page q ON q.section_id=x.id WHERE q.id=?1) AND id NOT IN (SELECT id FROM main.subject)", &[p])?;
                copy_rows(&tx, "section", "id=(SELECT section_id FROM b.page WHERE id=?1) AND id NOT IN (SELECT id FROM main.section)", &[p])?;
                copy_rows(&tx, "page", "id=?1", &[p])?;
                tx.execute("DELETE FROM main.element_tag WHERE element_id IN (SELECT id FROM main.element WHERE page_id=?1)", [p])?;
                tx.execute("DELETE FROM main.element WHERE page_id=?1", [p])?;
                tx.execute("DELETE FROM main.asset WHERE page_id=?1", [p])?;
                copy_rows(&tx, "element", "page_id=?1", &[p])?;
                copy_rows(&tx, "element_tag", "element_id IN (SELECT id FROM b.element WHERE page_id=?1)", &[p])?;
                copy_rows(&tx, "asset", "page_id=?1", &[p])?;
                tx.execute("UPDATE main.page SET updated_at=?2 WHERE id=?1", params![p, crate::db::repo::now_ms()])?;
            }
            want.into_iter().collect()
        };
        for p in &pages {
            crate::db::onenote::reindex_page(&tx, p)?;
        }
        tx.commit()?;
        Ok(pages.len())
    })();
    let _ = conn.pragma_update(None, "foreign_keys", true);
    let _ = conn.execute("DETACH DATABASE b", []);
    res
}

// ---------- Commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupState {
    config: BackupConfig,
    dir: String,
    default_dir: String,
    backups: Vec<BackupInfo>,
}

fn state(app: &AppHandle, db: &Db) -> BackupState {
    let conn = db.conn();
    let d = dir(app, &conn);
    BackupState {
        config: config(&conn),
        dir: d.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
        default_dir: default_dir(app).map(|p| p.display().to_string()).unwrap_or_default(),
        backups: d.as_deref().map(list).unwrap_or_default(),
    }
}

fn need_dir(app: &AppHandle, db: &Db) -> Result<PathBuf> {
    dir(app, &db.conn()).ok_or_else(|| Error::Invalid("Kein Sicherungsordner".into()))
}

#[tauri::command]
pub fn backup_state(app: AppHandle, db: tauri::State<Db>) -> BackupState {
    state(&app, &db)
}

#[tauri::command]
pub fn set_backup_config(app: AppHandle, db: tauri::State<Db>, config: BackupConfig) -> Result<BackupState> {
    set_config(&db.conn(), &config)?;
    if let Some(d) = dir(&app, &db.conn()) {
        prune(&d, &config);
    }
    Ok(state(&app, &db))
}

#[tauri::command]
pub fn backup_create(app: AppHandle, db: tauri::State<Db>) -> Result<BackupState> {
    let d = need_dir(&app, &db)?;
    create(&db, &d, true)?;
    Ok(state(&app, &db))
}

#[tauri::command]
pub fn backup_preview(app: AppHandle, db: tauri::State<Db>, name: String) -> Result<Vec<PreviewSubject>> {
    let p = backup_path(&need_dir(&app, &db)?, &name)?;
    let (tmp, b) = open_copy(&p)?;
    let r = preview(&db.conn(), &b.conn());
    drop(b);
    let _ = std::fs::remove_file(tmp);
    r
}

/// Elemente eines Blatts aus der Sicherung (Vorschaubild im Frontend).
#[tauri::command]
pub fn backup_page_elements(app: AppHandle, db: tauri::State<Db>, name: String, page_id: String) -> Result<Vec<crate::db::models::Element>> {
    let p = backup_path(&need_dir(&app, &db)?, &name)?;
    let (tmp, b) = open_copy(&p)?;
    let r = crate::db::repo::list_elements(&b.conn(), &page_id);
    drop(b);
    let _ = std::fs::remove_file(tmp);
    r
}

#[tauri::command]
pub fn backup_restore(app: AppHandle, db: tauri::State<Db>, name: String, scope: RestoreScope) -> Result<usize> {
    let d = need_dir(&app, &db)?;
    let p = backup_path(&d, &name)?;
    // aktuellen Stand vorher sichern
    vacuum_into(&db, &d, &format!("{SAFETY}{}{EXT}", chrono::Local::now().format("%Y-%m-%d-%H%M%S")))?;
    let (tmp, b) = open_copy(&p)?;
    drop(b);
    let r = restore(&mut db.conn(), &tmp, &scope);
    let _ = std::fs::remove_file(tmp);
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo;

    #[test]
    fn sichert_einmal_taeglich() {
        let dir = std::env::temp_dir().join(format!("nf-backup-{}", uuid::Uuid::new_v4()));
        let db = Db::open_in_memory().unwrap();
        repo::create_subject(&db.conn(), "Mathe", "#000", "x").unwrap();
        assert!(create(&db, &dir, false).unwrap().is_some());
        assert!(create(&db, &dir, false).unwrap().is_none(), "zweite Sicherung am selben Tag");
        let today = dir.join(format!("{PREFIX}{}{EXT}", chrono::Local::now().format("%Y-%m-%d")));
        let c = rusqlite::Connection::open(today).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM subject", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        drop(c); // Windows: offene Datei verhindert das Löschen
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn aufbewahrung_taeglich_woechentlich_monatlich() {
        // 120 Tage täglich ab 2026-01-01
        let start = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let names: Vec<String> = (0..120).map(|i| format!("{PREFIX}{}{EXT}", start + chrono::Days::new(i))).collect();
        let keep = retained(&names, &BackupConfig { dir: None, daily: 7, weekly: 4, monthly: 6 });
        let last = start + chrono::Days::new(119); // 2026-04-30
        for i in 0..7 {
            assert!(keep.contains(&format!("{PREFIX}{}{EXT}", last - chrono::Days::new(i))));
        }
        // Monate Jan–Apr je die neueste
        assert!(keep.contains(&format!("{PREFIX}2026-01-31{EXT}")));
        assert!(keep.contains(&format!("{PREFIX}2026-03-31{EXT}")));
        assert!(!keep.contains(&format!("{PREFIX}2026-01-15{EXT}")));
        // höchstens 7 + 4 + 6
        assert!(keep.len() <= 17 && keep.len() >= 10, "{}", keep.len());
    }

    fn page_with_stroke(db: &Db) -> (String, String) {
        let mut c = db.conn();
        let s = repo::create_subject(&c, "Physik", "#000", "x").unwrap();
        let sec = repo::create_section(&c, &s.id, "Optik", "#000").unwrap();
        let p = repo::create_page(&c, &sec.id, None, "Linsen").unwrap();
        let e = crate::db::models::Element {
            id: "e1".into(), page_id: p.id.clone(), kind: "stroke".into(), z: 1,
            bbox: crate::db::models::BBox { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, data: vec![1, 2, 3],
        };
        repo::save_elements(&mut c, &p.id, &[e], &[]).unwrap();
        (s.id, p.id)
    }

    #[test]
    fn blatt_und_komplett_wiederherstellen() {
        let dir = std::env::temp_dir().join(format!("nf-restore-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("live.sqlite");
        let db = Db::open(&file).unwrap();
        let (sid, pid) = page_with_stroke(&db);
        let bk = vacuum_into(&db, &dir, &format!("{PREFIX}2026-01-01{EXT}")).unwrap();
        // Danach: Element gelöscht, Blatt umbenannt, neues Fach
        repo::save_elements(&mut db.conn(), &pid, &[], &["e1".into()]).unwrap();
        repo::update_page(&db.conn(), &pid, crate::db::models::PagePatch { title: Some("Neu".into()), ..Default::default() }).unwrap();
        repo::create_subject(&db.conn(), "Chemie", "#000", "x").unwrap();

        let (tmp, b) = open_copy(&bk).unwrap();
        let pv = preview(&db.conn(), &b.conn()).unwrap();
        assert_eq!(pv[0].sections[0].pages[0].current, "changed");
        assert_eq!(pv[0].sections[0].pages[0].elements, 1);
        drop(b);

        let n = restore(&mut db.conn(), &tmp, &RestoreScope { pages: vec![pid.clone()], ..Default::default() }).unwrap();
        assert_eq!(n, 1);
        assert_eq!(repo::list_elements(&db.conn(), &pid).unwrap().len(), 1);
        assert_eq!(repo::get_page(&db.conn(), &pid).unwrap().title, "Linsen");
        assert_eq!(repo::list_subjects(&db.conn()).unwrap().len(), 2, "Chemie bleibt bei Teil-Wiederherstellung");

        restore(&mut db.conn(), &tmp, &RestoreScope { subjects: vec![sid], ..Default::default() }).unwrap();
        restore(&mut db.conn(), &tmp, &RestoreScope { all: true, ..Default::default() }).unwrap();
        assert_eq!(repo::list_subjects(&db.conn()).unwrap().len(), 1, "komplett = Stand der Sicherung");
        let _ = std::fs::remove_file(tmp);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
