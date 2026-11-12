//! Tägliches lokales Backup der Datenbank (SPEC §9) per `VACUUM INTO` –
//! konsistent auch während die App läuft. Die letzten `KEEP` Sicherungen bleiben erhalten.

use crate::db::{Db, Error, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const KEEP: usize = 14;
const PREFIX: &str = "noteforge-";
const EXT: &str = ".sqlite";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created: i64,
}

pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("backups"))
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

/// Legt das Backup für heute an (`force`: zusätzlich eines mit Uhrzeit). Liefert den Pfad, falls neu.
pub fn create(db: &Db, dir: &Path, force: bool) -> Result<Option<PathBuf>> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let exists = list(dir).iter().any(|b| b.name.starts_with(&format!("{PREFIX}{today}")));
    if exists && !force {
        return Ok(None);
    }
    std::fs::create_dir_all(dir)?;
    let name = if exists {
        format!("{PREFIX}{today}-{}{EXT}", chrono::Local::now().format("%H%M%S"))
    } else {
        format!("{PREFIX}{today}{EXT}")
    };
    let path = dir.join(&name);
    let tmp = dir.join(format!("{name}.tmp"));
    let _ = std::fs::remove_file(&tmp);
    db.conn()
        .execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])
        .map_err(Error::from)?;
    std::fs::rename(&tmp, &path)?;
    for old in list(dir).into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(dir.join(old.name));
    }
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sichert_einmal_taeglich_und_raeumt_auf() {
        let dir = std::env::temp_dir().join(format!("nf-backup-{}", uuid::Uuid::new_v4()));
        let db = Db::open_in_memory().unwrap();
        crate::db::repo::create_subject(&db.conn(), "Mathe", "#000", "x").unwrap();
        assert!(create(&db, &dir, false).unwrap().is_some());
        assert!(create(&db, &dir, false).unwrap().is_none(), "zweites Backup am selben Tag");
        for i in 0..20 {
            std::fs::write(dir.join(format!("{PREFIX}2000-01-{:02}{EXT}", i + 1)), b"x").unwrap();
        }
        create(&db, &dir, true).unwrap().unwrap();
        let l = list(&dir);
        assert_eq!(l.len(), KEEP);
        // Das Backup ist eine gültige Datenbank mit den Daten
        let today = dir.join(format!("{PREFIX}{}{EXT}", chrono::Local::now().format("%Y-%m-%d")));
        let c = rusqlite::Connection::open(today).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM subject", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        drop(c); // Windows: offene Datei verhindert das Löschen
        std::fs::remove_dir_all(dir).unwrap();
    }
}
