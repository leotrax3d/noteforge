//! Bug-Reports an Supabase (SPEC §15). Die App sendet mit dem öffentlichen anon-Schlüssel nur `INSERT`;
//! RLS erlaubt anon weder Lesen noch Ändern. URL und Schlüssel kommen beim Bauen aus
//! `NOTEFORGE_SUPABASE_URL` / `NOTEFORGE_SUPABASE_ANON_KEY` – geheime Schlüssel (service_role) nie.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MIN_LEN: usize = 10;
pub const MAX_LEN: usize = 5000;
const COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize, PartialEq)]
pub struct Payload {
    pub description: String,
    pub app_version: String,
    pub platform: String,
}

/// Prüft und normalisiert die Beschreibung (gleiche Grenzen wie der CHECK in der Datenbank).
pub fn payload(description: &str) -> Result<Payload, String> {
    let d = description.trim();
    let n = d.chars().count();
    if n < MIN_LEN {
        return Err(format!("Bitte beschreibe den Fehler etwas genauer (mindestens {MIN_LEN} Zeichen)."));
    }
    if n > MAX_LEN {
        return Err(format!("Die Beschreibung ist zu lang (höchstens {MAX_LEN} Zeichen)."));
    }
    Ok(Payload {
        description: d.to_string(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    })
}

/// Projekt-URL und anon-Schlüssel; `None`, wenn beim Bauen nicht gesetzt.
pub fn config() -> Option<(String, String)> {
    let url = option_env!("NOTEFORGE_SUPABASE_URL")?.trim().trim_end_matches('/');
    let key = option_env!("NOTEFORGE_SUPABASE_ANON_KEY")?.trim();
    (!url.is_empty() && !key.is_empty()).then(|| (url.to_string(), key.to_string()))
}

/// Verständliche Meldung zu einer HTTP-Antwort von PostgREST.
pub fn status_message(code: u16) -> String {
    match code {
        200..=299 => "Danke! Dein Bericht ist angekommen.".into(),
        400 | 422 => "Der Bericht wurde abgelehnt (ungültiger Inhalt).".into(),
        401 | 403 => "Der Server hat den Bericht nicht angenommen (Berechtigung). Bitte melde dich beim Entwickler.".into(),
        404 => "Der Bug-Report-Dienst ist nicht eingerichtet.".into(),
        429 => "Zu viele Berichte in kurzer Zeit – bitte später erneut versuchen.".into(),
        500..=599 => "Der Server ist gerade nicht erreichbar – bitte später erneut versuchen.".into(),
        c => format!("Senden fehlgeschlagen (HTTP {c})."),
    }
}

static LAST: Mutex<Option<Instant>> = Mutex::new(None);

#[tauri::command]
pub async fn submit_bug_report(description: String) -> Result<String, String> {
    let p = payload(&description)?;
    let (url, key) = config().ok_or("Bug-Reports sind in dieser Version nicht eingerichtet.")?;
    if let Some(t) = *LAST.lock().unwrap_or_else(|e| e.into_inner())
        && t.elapsed() < COOLDOWN
    {
        return Err("Bitte warte einen Moment, bevor du einen weiteren Bericht sendest.".into());
    }
    let http = reqwest::Client::builder()
        .user_agent(concat!("Noteforge/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = http.post(format!("{url}/rest/v1/bug_reports")).header("apikey", &key);
    // Alter anon-Schlüssel ist ein JWT und gehört auch in Authorization; neue „sb_publishable_…“-Schlüssel nicht.
    if key.starts_with("eyJ") {
        req = req.bearer_auth(&key);
    }
    let res = req
        .header("Prefer", "return=minimal")
        .json(&p)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() || e.is_connect() {
                "Keine Verbindung zum Server – bitte Internet prüfen und erneut versuchen.".to_string()
            } else {
                format!("Senden fehlgeschlagen: {e}")
            }
        })?;
    let code = res.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(status_message(code));
    }
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    Ok(status_message(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_length_and_trims() {
        assert!(payload("  kurz  ").is_err());
        assert!(payload(&"x".repeat(MAX_LEN + 1)).is_err());
        let p = payload("  Kalender stürzt ab  \n").unwrap();
        assert_eq!(p.description, "Kalender stürzt ab");
        assert_eq!(p.app_version, env!("CARGO_PKG_VERSION"));
        assert!(!p.platform.is_empty());
        // Umlaute zählen als ein Zeichen
        assert!(payload("äöüäöüäöüä").is_ok());
    }

    #[test]
    fn json_has_only_allowed_columns() {
        let v = serde_json::to_value(payload("Fehler beim Speichern").unwrap()).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["app_version", "description", "platform"], "nur Spalten mit INSERT-Recht");
    }

    #[test]
    fn german_status_messages() {
        assert!(status_message(201).starts_with("Danke"));
        assert!(status_message(401).contains("Berechtigung"));
        assert!(status_message(503).contains("später"));
        assert!(status_message(418).contains("418"));
    }
}
