//! Bug-Reports an Supabase (SPEC §15). Die App sendet mit dem öffentlichen anon-Schlüssel nur `INSERT`;
//! RLS erlaubt anon weder Lesen noch Ändern. URL und Schlüssel kommen beim Bauen aus
//! `NOTEFORGE_SUPABASE_URL` / `NOTEFORGE_SUPABASE_ANON_KEY` – geheime Schlüssel (service_role) nie.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MIN_LEN: usize = 10;
pub const MAX_LEN: usize = 5000;
const COOLDOWN: Duration = Duration::from_secs(30);

pub const MAX_SHOT: usize = 2 * 1024 * 1024;
const BUCKET: &str = "bug-screenshots";

#[derive(Debug, Serialize, PartialEq)]
pub struct Payload {
    pub description: String,
    pub app_version: String,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_path: Option<String>,
}

/// Bildschirmfoto (Base64, JPEG oder PNG) prüfen → (Bytes, Dateiname, MIME-Typ).
pub fn screenshot(b64: &str) -> Result<(Vec<u8>, String, &'static str), String> {
    use base64::Engine;
    let raw = b64.split_once("base64,").map_or(b64, |(_, d)| d);
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw.trim()).map_err(|_| "Bildschirmfoto unlesbar")?;
    if bytes.len() > MAX_SHOT {
        return Err("Bildschirmfoto ist zu groß (höchstens 2 MB).".into());
    }
    let (ext, mime) = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ("jpg", "image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        ("png", "image/png")
    } else {
        return Err("Bildschirmfoto hat ein unbekanntes Format.".into());
    };
    Ok((bytes, format!("{}.{ext}", uuid::Uuid::new_v4().simple()), mime))
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
        screenshot_path: None,
    })
}

/// Projekt-URL und anon-Schlüssel; `None`, wenn beim Bauen nicht gesetzt.
/// Öffentliches Noteforge-Projekt als Standard; beim Bauen per Umgebungsvariable überschreibbar.
const DEFAULT_URL: &str = "https://pcccowrdxfpnstmftthk.supabase.co";
const DEFAULT_KEY: &str = "sb_publishable_gCWGMssp40UTa5WNkyFSpg_pREJ65pG";

pub fn config() -> Option<(String, String)> {
    let url = option_env!("NOTEFORGE_SUPABASE_URL").filter(|s| !s.trim().is_empty()).unwrap_or(DEFAULT_URL).trim().trim_end_matches('/');
    let key = option_env!("NOTEFORGE_SUPABASE_ANON_KEY").filter(|s| !s.trim().is_empty()).unwrap_or(DEFAULT_KEY).trim();
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

fn authed(req: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    // Alter anon-Schlüssel ist ein JWT und gehört auch in Authorization; neue „sb_publishable_…“-Schlüssel nicht.
    let req = req.header("apikey", key);
    if key.starts_with("eyJ") { req.bearer_auth(key) } else { req }
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_timeout() || e.is_connect() {
        "Keine Verbindung zum Server – bitte Internet prüfen und erneut versuchen.".to_string()
    } else {
        format!("Senden fehlgeschlagen: {e}")
    }
}

/// Sendet den Bericht; ein Bildschirmfoto wird vorher in den privaten Bucket geladen. Schlägt nur
/// das Hochladen fehl, geht der Bericht trotzdem raus (ohne Bild) – das meldet die Rückgabe.
#[tauri::command]
pub async fn submit_bug_report(description: String, screenshot_b64: Option<String>) -> Result<String, String> {
    let mut p = payload(&description)?;
    let shot = screenshot_b64.as_deref().filter(|s| !s.is_empty()).map(screenshot).transpose()?;
    let (url, key) = config().ok_or("Bug-Reports sind in dieser Version nicht eingerichtet.")?;
    if let Some(t) = *LAST.lock().unwrap_or_else(|e| e.into_inner())
        && t.elapsed() < COOLDOWN
    {
        return Err("Bitte warte einen Moment, bevor du einen weiteren Bericht sendest.".into());
    }
    let http = reqwest::Client::builder()
        .user_agent(concat!("Noteforge/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut shot_failed = false;
    if let Some((bytes, name, mime)) = shot {
        let up = authed(http.post(format!("{url}/storage/v1/object/{BUCKET}/{name}")), &key)
            .header("Content-Type", mime)
            .header("x-upsert", "false")
            .body(bytes)
            .send()
            .await;
        match up {
            Ok(r) if r.status().is_success() => p.screenshot_path = Some(name),
            _ => shot_failed = true,
        }
    }
    let res = authed(http.post(format!("{url}/rest/v1/bug_reports")), &key)
        .header("Prefer", "return=minimal")
        .json(&p)
        .send()
        .await
        .map_err(net_err)?;
    let code = res.status().as_u16();
    if !(200..300).contains(&code) {
        return Err(status_message(code));
    }
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    let mut msg = status_message(code);
    if shot_failed {
        msg.push_str(" Das Bildschirmfoto konnte nicht hochgeladen werden.");
    }
    Ok(msg)
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
        let mut p = payload("Fehler beim Speichern").unwrap();
        p.screenshot_path = Some("ab.jpg".into());
        assert_eq!(serde_json::to_value(&p).unwrap()["screenshot_path"], "ab.jpg");
    }

    #[test]
    fn screenshot_checks_format_and_size() {
        use base64::Engine;
        let b = |v: &[u8]| base64::engine::general_purpose::STANDARD.encode(v);
        let (bytes, name, mime) = screenshot(&format!("data:image/jpeg;base64,{}", b(&[0xFF, 0xD8, 0xFF, 0xE0, 1, 2]))).unwrap();
        assert_eq!((bytes.len(), mime), (6, "image/jpeg"));
        assert!(name.len() == 36 && name.ends_with(".jpg") && name[..32].chars().all(|c| c.is_ascii_hexdigit()), "{name}");
        assert_eq!(screenshot(&b(b"\x89PNG\r\n\x1a\nxx")).unwrap().2, "image/png");
        assert!(screenshot(&b(b"<html>")).is_err());
        assert!(screenshot("%%%").is_err());
        let mut big = vec![0xFF, 0xD8, 0xFF];
        big.resize(MAX_SHOT + 1, 0);
        assert!(screenshot(&b(&big)).unwrap_err().contains("2 MB"));
    }

    #[test]
    fn german_status_messages() {
        assert!(status_message(201).starts_with("Danke"));
        assert!(status_message(401).contains("Berechtigung"));
        assert!(status_message(503).contains("später"));
        assert!(status_message(418).contains("418"));
    }
}
