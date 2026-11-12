//! SQLite-Persistenz (SPEC §3). Zugriff ausschließlich über Tauri-Commands.

pub mod models;
pub mod onenote;
pub mod repo;
pub mod school;

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Datenbankfehler: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Nicht gefunden: {0}")]
    NotFound(String),
    #[error("Ungültig: {0}")]
    Invalid(String),
    #[error("Dateifehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("Datenformat: {0}")]
    Json(#[from] serde_json::Error),
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Geordnete Migrationen; Index + 1 = `PRAGMA user_version` nach Anwendung.
const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_init.sql"),
    include_str!("../../migrations/0002_onenote.sql"),
    include_str!("../../migrations/0003_calendar.sql"),
    include_str!("../../migrations/0004_integrations.sql"),
    include_str!("../../migrations/0005_recognition.sql"),
    include_str!("../../migrations/0006_sync.sql"),
    include_str!("../../migrations/0007_school.sql"),
    include_str!("../../migrations/0008_assets.sql"),
];

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&mut conn)?;
        onenote::maintenance(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        // Ein Panik-vergifteter Mutex hält trotzdem eine gültige Verbindung.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let current = current as usize;
    if current > MIGRATIONS.len() {
        return Err(Error::Invalid(format!(
            "Datenbank-Schema {current} ist neuer als diese App-Version"
        )));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn schema_version() -> usize {
    MIGRATIONS.len()
}
