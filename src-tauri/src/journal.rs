//! Absturzschutz (SPEC §10.2): Jede Änderung landet zuerst gebündelt in einem Write-Ahead-Journal
//! (`journal.ndjson` im Datenordner, nach jedem Schreiben `fsync`). Nach erfolgreichem Speichern in
//! SQLite (WAL-Modus) markiert ein Commit-Eintrag die Änderungen als erledigt. Beim Start werden
//! nicht bestätigte Einträge in die Datenbank übernommen („X Änderungen wiederhergestellt“).

use crate::db::models::Element;
use crate::db::{Db, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

pub const FILE: &str = "journal.ndjson";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Sitzung (Fensterladung) + fortlaufende Nummer je Sitzung
    pub session: String,
    pub seq: u64,
    pub page_id: String,
    pub upserts: Vec<Element>,
    pub deletes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Commit {
    session: String,
    page_id: String,
    up_to: u64,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
enum Line {
    Entry(Entry),
    Commit(Commit),
}

pub struct Journal {
    path: PathBuf,
    /// offene (unbestätigte) höchste Nummer je (Sitzung, Blatt)
    open: Mutex<HashMap<(String, String), u64>>,
    /** bereits bestätigte höchste Nummer je (Sitzung, Blatt): verspätete ältere Einträge verwerfen */
    committed: Mutex<HashMap<(String, String), u64>>,
    recovered: Mutex<Option<usize>>,
}

impl Journal {
    pub fn new(dir: &Path) -> Self {
        Self { path: dir.join(FILE), open: Mutex::new(HashMap::new()), committed: Mutex::new(HashMap::new()), recovered: Mutex::new(None) }
    }

    fn append(&self, line: &Line) -> Result<()> {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        let mut s = serde_json::to_vec(line)?;
        s.push(b'\n');
        f.write_all(&s)?;
        f.sync_data()?; // dauerhaft auf der Platte, bevor wir bestätigen
        Ok(())
    }

    pub fn write(&self, e: Entry) -> Result<()> {
        let key = (e.session.clone(), e.page_id.clone());
        let seq = e.seq;
        if self.committed.lock().unwrap_or_else(|p| p.into_inner()).get(&key).is_some_and(|&c| c >= seq) {
            return Ok(()); // schon gespeichert – veralteter Stand darf nie zurückgespielt werden
        }
        self.append(&Line::Entry(e))?;
        let mut open = self.open.lock().unwrap_or_else(|p| p.into_inner());
        let v = open.entry(key).or_insert(0);
        *v = (*v).max(seq);
        Ok(())
    }

    pub fn commit(&self, session: String, page_id: String, up_to: u64) -> Result<()> {
        let key = (session.clone(), page_id.clone());
        {
            let mut c = self.committed.lock().unwrap_or_else(|p| p.into_inner());
            let v = c.entry(key.clone()).or_insert(0);
            *v = (*v).max(up_to);
        }
        let mut open = self.open.lock().unwrap_or_else(|p| p.into_inner());
        if open.get(&key).is_some_and(|&m| m <= up_to) {
            open.remove(&key);
        }
        if open.is_empty() {
            // alles gespeichert → Journal leeren
            std::fs::write(&self.path, b"")?;
            return Ok(());
        }
        drop(open);
        self.append(&Line::Commit(Commit { session, page_id, up_to }))
    }

    /// Beim Start: unbestätigte Einträge anwenden, Journal leeren. Liefert die Anzahl Änderungen.
    pub fn recover(&self, db: &Db) -> Result<usize> {
        let n = recover_file(&self.path, db)?;
        *self.recovered.lock().unwrap_or_else(|p| p.into_inner()) = Some(n);
        Ok(n)
    }
}

pub fn recover_file(path: &Path, db: &Db) -> Result<usize> {
    let Ok(text) = std::fs::read_to_string(path) else { return Ok(0) };
    let mut entries = Vec::new();
    let mut done: HashMap<(String, String), u64> = HashMap::new();
    for line in text.lines() {
        // Eine beim Absturz halb geschriebene letzte Zeile wird übersprungen
        match serde_json::from_str::<Line>(line) {
            Ok(Line::Entry(e)) => entries.push(e),
            Ok(Line::Commit(c)) => {
                let v = done.entry((c.session, c.page_id)).or_insert(0);
                *v = (*v).max(c.up_to);
            }
            Err(_) => {}
        }
    }
    let mut changed = HashSet::new();
    let mut conn = db.conn();
    for e in entries {
        if done.get(&(e.session.clone(), e.page_id.clone())).is_some_and(|&d| d >= e.seq) {
            continue;
        }
        // Blatt inzwischen gelöscht → überspringen
        if crate::db::repo::get_page(&conn, &e.page_id).is_err() {
            continue;
        }
        crate::db::repo::save_elements(&mut conn, &e.page_id, &e.upserts, &e.deletes)?;
        changed.extend(e.upserts.iter().map(|u| u.id.clone()));
        changed.extend(e.deletes.iter().cloned());
    }
    drop(conn);
    std::fs::write(path, b"")?;
    Ok(changed.len())
}

#[tauri::command]
pub fn journal_write(j: State<Journal>, entry: Entry) -> Result<()> {
    j.write(entry)
}

#[tauri::command]
pub fn journal_commit(j: State<Journal>, session: String, page_id: String, up_to: u64) -> Result<()> {
    j.commit(session, page_id, up_to)
}

/// Anzahl der beim Start wiederhergestellten Änderungen (einmalig, danach 0).
#[tauri::command]
pub fn journal_recovered(j: State<Journal>) -> usize {
    j.recovered.lock().unwrap_or_else(|p| p.into_inner()).take().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::BBox;
    use crate::db::repo;

    fn el(id: &str, page: &str) -> Element {
        Element { id: id.into(), page_id: page.into(), kind: "stroke".into(), z: 1, bbox: BBox { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, data: vec![1, 2, 3] }
    }

    fn setup(dir: &Path) -> (Db, String) {
        let db = Db::open(&dir.join("nf.sqlite")).unwrap();
        let s = repo::create_subject(&db.conn(), "Mathe", "#000", "x").unwrap();
        let sec = repo::create_section(&db.conn(), &s.id, "A", "#000").unwrap();
        let p = repo::create_page(&db.conn(), &sec.id, None, "").unwrap();
        (db, p.id)
    }

    #[test]
    fn bestaetigte_eintraege_werden_nicht_wiederholt() {
        let dir = std::env::temp_dir().join(format!("nf-j-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (db, page) = setup(&dir);
        let j = Journal::new(&dir);
        j.write(Entry { session: "s".into(), seq: 1, page_id: page.clone(), upserts: vec![el("a", &page)], deletes: vec![] }).unwrap();
        j.write(Entry { session: "s".into(), seq: 2, page_id: page.clone(), upserts: vec![el("b", &page)], deletes: vec![] }).unwrap();
        j.commit("s".into(), page.clone(), 1).unwrap();
        // halb geschriebene Zeile wie nach einem Absturz
        std::fs::OpenOptions::new().append(true).open(dir.join(FILE)).unwrap().write_all(b"{\"session\":\"s\",\"se").unwrap();
        assert_eq!(recover_file(&dir.join(FILE), &db).unwrap(), 1);
        let ids: Vec<_> = repo::list_elements(&db.conn(), &page).unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["b"]);
        assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), "");
        j.commit("s".into(), page.clone(), 2).unwrap();
        // verspätet eintreffender älterer Stand wird verworfen
        j.write(Entry { session: "s".into(), seq: 2, page_id: page, upserts: vec![], deletes: vec!["b".into()] }).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(FILE)).unwrap(), "");
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Absturztest: Ein Kindprozess schreibt Journal-Einträge und wird hart beendet (SIGKILL/TerminateProcess).
    /// Danach übernimmt die Wiederherstellung alle unbestätigten Änderungen.
    #[test]
    fn harter_abbruch_wird_wiederhergestellt() {
        if let Ok(dir) = std::env::var("NF_JOURNAL_CHILD") {
            let dir = PathBuf::from(dir);
            let page = std::fs::read_to_string(dir.join("page")).unwrap();
            let j = Journal::new(&dir);
            for i in 0..1_000_000u64 {
                j.write(Entry { session: "kind".into(), seq: i + 1, page_id: page.clone(), upserts: vec![el(&format!("e{i}"), &page)], deletes: vec![] }).unwrap();
                if i == 4 {
                    std::fs::write(dir.join("ready"), b"1").unwrap();
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            return;
        }
        let dir = std::env::temp_dir().join(format!("nf-kill-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (db, page) = setup(&dir);
        std::fs::write(dir.join("page"), &page).unwrap();
        let exe = std::env::current_exe().unwrap();
        let mut child = std::process::Command::new(exe)
            .args(["--exact", "journal::tests::harter_abbruch_wird_wiederhergestellt", "--nocapture"])
            .env("NF_JOURNAL_CHILD", &dir)
            .spawn()
            .unwrap();
        let t0 = std::time::Instant::now();
        while !dir.join("ready").exists() {
            assert!(t0.elapsed().as_secs() < 30, "Kindprozess startet nicht");
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
        child.kill().unwrap(); // hart beenden
        child.wait().unwrap();
        let n = recover_file(&dir.join(FILE), &db).unwrap();
        assert!(n >= 5, "nur {n} wiederhergestellt");
        assert_eq!(repo::list_elements(&db.conn(), &page).unwrap().len(), n);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
