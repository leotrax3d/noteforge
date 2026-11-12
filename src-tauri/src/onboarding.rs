//! Erststart-Assistent: Speicherort, App-Einstellungen, WebUntis-Schulsuche.

use crate::db::{Db, Error, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const LOCATION_FILE: &str = "location.json";
pub const DB_FILE: &str = "noteforge.sqlite";

#[derive(Serialize, Deserialize, Default)]
struct Location {
    dir: Option<PathBuf>,
}

fn location_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(LOCATION_FILE))
}

/// Datenordner: gewählter Speicherort, sonst App-Datenordner (bisheriges Verhalten).
pub fn data_dir(app: &AppHandle) -> std::result::Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(p) = location_path(app)
        && let Ok(s) = std::fs::read_to_string(p)
        && let Ok(Location { dir: Some(d) }) = serde_json::from_str::<Location>(&s)
        && d.is_dir()
    {
        return Ok(d);
    }
    Ok(app.path().app_data_dir()?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocation {
    current: String,
    suggested: String,
}

#[tauri::command]
pub fn data_location(app: AppHandle) -> Result<DataLocation> {
    let current = data_dir(&app).map_err(|e| Error::Invalid(e.to_string()))?;
    let docs = app.path().document_dir().map_err(|e| Error::Invalid(e.to_string()))?;
    Ok(DataLocation { current: current.display().to_string(), suggested: docs.join("Noteforge").display().to_string() })
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirCheck {
    writable: bool,
    /// Name des Cloud-Dienstes, wenn der Ordner in einem synchronisierten Ordner liegt
    cloud: Option<String>,
    has_data: bool,
    error: Option<String>,
}

/// Erkennt typische Cloud-Sync-Ordner am Pfad (OneDrive, Nextcloud, Dropbox …).
pub fn cloud_service(p: &Path) -> Option<String> {
    const KNOWN: &[(&str, &str)] = &[
        ("onedrive", "OneDrive"), ("nextcloud", "Nextcloud"), ("owncloud", "ownCloud"), ("dropbox", "Dropbox"),
        ("icloud", "iCloud"), ("google drive", "Google Drive"), ("googledrive", "Google Drive"), ("seadrive", "Seafile"),
    ];
    for c in p.components() {
        let s = c.as_os_str().to_string_lossy().to_lowercase();
        for (k, name) in KNOWN {
            if s.starts_with(k) || s.contains(&format!(" {k}")) {
                return Some((*name).into());
            }
        }
    }
    if let Ok(od) = std::env::var("OneDrive")
        && !od.is_empty()
        && p.starts_with(&od)
    {
        return Some("OneDrive".into());
    }
    None
}

pub fn check_dir(p: &Path) -> DirCheck {
    let cloud = cloud_service(p);
    let res = (|| -> std::io::Result<()> {
        std::fs::create_dir_all(p)?;
        let probe = p.join(".noteforge-schreibtest");
        std::fs::write(&probe, b"ok")?;
        std::fs::remove_file(&probe)
    })();
    DirCheck { writable: res.is_ok(), cloud, has_data: p.join(DB_FILE).is_file(), error: res.err().map(|e| e.to_string()) }
}

#[tauri::command]
pub fn check_data_dir(path: String) -> DirCheck {
    check_dir(Path::new(&path))
}

/// Speicherort festlegen. Liegt dort noch keine Datenbank, wird die aktuelle konsistent dorthin kopiert
/// (`VACUUM INTO`). Wirksam nach Neustart der App.
#[tauri::command]
pub fn set_data_dir(app: AppHandle, db: State<Db>, path: String) -> Result<bool> {
    let target = PathBuf::from(&path);
    let chk = check_dir(&target);
    if !chk.writable {
        return Err(Error::Invalid(format!("Ordner ist nicht beschreibbar: {}", chk.error.unwrap_or_default())));
    }
    let current = data_dir(&app).map_err(|e| Error::Invalid(e.to_string()))?;
    if current == target {
        return Ok(false);
    }
    if !chk.has_data {
        let dst = target.join(DB_FILE);
        db.conn().execute("VACUUM INTO ?1", [dst.to_string_lossy()])?;
    }
    let lp = location_path(&app).ok_or_else(|| Error::Invalid("Kein Konfigurationsordner".into()))?;
    if let Some(d) = lp.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(lp, serde_json::to_vec(&Location { dir: Some(target) })?)?;
    Ok(true)
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

// ---------- App-Einstellungen (nur Schlüssel „app.*“, z. B. Erinnerungen) ----------

fn app_key(key: &str) -> Result<()> {
    if key.starts_with("app.") && key.len() < 64 { Ok(()) } else { Err(Error::Invalid(format!("Unbekannte Einstellung {key}"))) }
}

#[tauri::command]
pub fn app_settings(db: State<Db>) -> Result<HashMap<String, String>> {
    let conn = db.conn();
    let mut st = conn.prepare("SELECT key, value FROM setting WHERE key LIKE 'app.%'")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub fn set_app_setting(db: State<Db>, key: String, value: String) -> Result<()> {
    app_key(&key)?;
    db.conn().execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn app_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM setting WHERE key=?1", [key], |r| r.get(0)).optional().ok().flatten()
}

// ---------- WebUntis-Schulsuche (öffentliche Schulsuche der WebUntis-App) ----------

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct School {
    name: String,
    address: String,
    server: String,
    login: String,
}

pub fn parse_schools(v: &serde_json::Value) -> std::result::Result<Vec<School>, String> {
    if let Some(e) = v.get("error") {
        let code = e.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        // -6003: zu viele Treffer
        return Err(if code == -6003 { "Zu viele Treffer – bitte genauer suchen".into() } else { "Schulsuche fehlgeschlagen".into() });
    }
    let list = v.pointer("/result/schools").and_then(|s| s.as_array()).cloned().unwrap_or_default();
    Ok(list
        .iter()
        .filter_map(|s| {
            let url = s.get("serverUrl").and_then(|x| x.as_str()).or_else(|| s.get("server").and_then(|x| x.as_str()))?;
            let host = url.trim_start_matches("https://").trim_start_matches("http://").split('/').next()?.to_string();
            Some(School {
                name: s.get("displayName").and_then(|x| x.as_str()).unwrap_or_default().into(),
                address: s.get("address").and_then(|x| x.as_str()).unwrap_or_default().into(),
                server: host,
                login: s.get("loginName").and_then(|x| x.as_str())?.into(),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn untis_search_schools(query: String) -> std::result::Result<Vec<School>, String> {
    let q = query.trim();
    if q.chars().count() < 3 {
        return Ok(Vec::new());
    }
    let body = serde_json::json!({ "id": "noteforge", "method": "searchSchool", "params": [{ "search": q }], "jsonrpc": "2.0" });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post("https://mobile.webuntis.com/ms/schoolquery2")
        .json(&body)
        .send()
        .await
        .map_err(|_| "Schulsuche nicht erreichbar – Internetverbindung prüfen".to_string())?;
    let v: serde_json::Value = res.json().await.map_err(|_| "Unerwartete Antwort der Schulsuche".to_string())?;
    parse_schools(&v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_cloud_folders() {
        assert_eq!(cloud_service(Path::new("C:/Users/a/OneDrive - Schule/Noteforge")).as_deref(), Some("OneDrive"));
        assert_eq!(cloud_service(Path::new("C:/Users/a/Nextcloud/Noteforge")).as_deref(), Some("Nextcloud"));
        assert_eq!(cloud_service(Path::new("C:/Users/a/Documents/Noteforge")), None);
    }

    #[test]
    fn checks_writable() {
        let d = std::env::temp_dir().join(format!("nf-check-{}", std::process::id()));
        let c = check_dir(&d);
        assert!(c.writable);
        assert!(!c.has_data);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn parses_schools() {
        let v = serde_json::json!({ "result": { "schools": [
            { "displayName": "Gymnasium Musterstadt", "address": "Musterstadt", "serverUrl": "https://neilo.webuntis.com/WebUntis/?school=gym-muster", "loginName": "gym-muster" }
        ]}});
        let s = parse_schools(&v).unwrap();
        assert_eq!(s[0].server, "neilo.webuntis.com");
        assert_eq!(s[0].login, "gym-muster");
        assert!(parse_schools(&serde_json::json!({ "error": { "code": -6003 } })).unwrap_err().contains("genauer"));
    }

    #[test]
    fn only_app_keys() {
        assert!(app_key("app.reminders").is_ok());
        assert!(app_key("untis.config").is_err());
    }
}
