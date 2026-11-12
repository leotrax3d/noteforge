//! Google Calendar API v3 (REST). Rate-Limits: exponentielles Backoff bei 429/403-rateLimit/5xx.

use super::super::IntErr;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const BASE: &str = "https://www.googleapis.com/calendar/v3";
const MAX_TRIES: u32 = 5;

type R<T> = Result<T, IntErr>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub access_role: String,
    #[serde(default)]
    pub primary: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventTime {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}

/// Termin, wie Google ihn liefert (nur die benötigten Felder).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GEvent {
    pub id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub start: EventTime,
    #[serde(default)]
    pub end: EventTime,
    #[serde(default)]
    pub extended_properties: Option<Value>,
}

impl GEvent {
    pub fn noteforge_id(&self) -> Option<&str> {
        self.extended_properties.as_ref()?.get("private")?.get("noteforgeId")?.as_str()
    }
}

pub struct Page {
    pub items: Vec<GEvent>,
    pub next_sync_token: Option<String>,
}

pub enum ListResult {
    Ok(Page),
    /// 410 Gone: syncToken ungültig → vollständig neu laden
    TokenExpired,
}

pub enum WriteResult {
    Ok(Box<GEvent>),
    /// 404/410: Termin existiert nicht (mehr)
    Gone,
    /// 409: ID bereits vergeben
    Conflict,
}

pub struct Api {
    http: reqwest::Client,
    token: String,
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Soll die Anfrage nach einer Pause wiederholt werden?
pub fn retryable(status: u16, body: &str) -> bool {
    status == 429
        || status >= 500
        || (status == 403 && (body.contains("rateLimitExceeded") || body.contains("userRateLimitExceeded")))
}

/// Wartezeit vor Versuch `n` (0-basiert): 1, 2, 4, 8 s + bis zu 0,5 s Streuung.
pub fn backoff(n: u32) -> Duration {
    let jitter = (uuid::Uuid::new_v4().as_bytes()[0] as u64) * 2;
    Duration::from_millis(1000 * (1u64 << n.min(4)) + jitter)
}

fn google_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(200).collect())
}

impl Api {
    pub fn new(token: String) -> Self {
        Self { http: reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap_or_default(), token }
    }

    /// Anfrage mit Backoff; liefert (Status, Body).
    async fn send(&self, method: reqwest::Method, url: &str, body: Option<&Value>) -> R<(u16, String)> {
        let mut n = 0;
        loop {
            let mut rq = self.http.request(method.clone(), url).bearer_auth(&self.token);
            if let Some(b) = body {
                rq = rq.json(b);
            }
            let resp = rq.send().await?;
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            if retryable(status, &text) && n + 1 < MAX_TRIES {
                tokio_sleep(backoff(n)).await;
                n += 1;
                continue;
            }
            if status == 401 {
                return Err(IntErr::Auth("Google: Anmeldung abgelaufen – bitte neu verbinden".into()));
            }
            if retryable(status, &text) {
                return Err(IntErr::Remote("Google: zu viele Anfragen – später erneut versuchen".into()));
            }
            return Ok((status, text));
        }
    }

    fn check(status: u16, text: &str) -> R<()> {
        if (200..300).contains(&status) {
            Ok(())
        } else {
            Err(IntErr::Remote(format!("Google ({status}): {}", google_message(text))))
        }
    }

    pub async fn calendars(&self) -> R<Vec<CalendarInfo>> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut url = format!("{BASE}/users/me/calendarList?maxResults=250");
            if let Some(p) = &page {
                url.push_str(&format!("&pageToken={}", enc(p)));
            }
            let (st, text) = self.send(reqwest::Method::GET, &url, None).await?;
            Self::check(st, &text)?;
            let v: Value = serde_json::from_str(&text).map_err(|e| IntErr::Remote(e.to_string()))?;
            if let Some(items) = v.get("items") {
                out.extend(serde_json::from_value::<Vec<CalendarInfo>>(items.clone()).unwrap_or_default());
            }
            page = v.get("nextPageToken").and_then(|t| t.as_str()).map(String::from);
            if page.is_none() {
                return Ok(out);
            }
        }
    }

    /// E-Mail-Adresse des Kontos = ID des Hauptkalenders.
    pub async fn primary_id(&self) -> R<String> {
        let (st, text) = self.send(reqwest::Method::GET, &format!("{BASE}/calendars/primary"), None).await?;
        Self::check(st, &text)?;
        let v: Value = serde_json::from_str(&text).map_err(|e| IntErr::Remote(e.to_string()))?;
        v.get("id").and_then(|i| i.as_str()).map(String::from).ok_or_else(|| IntErr::Remote("Google: Konto unbekannt".into()))
    }

    pub async fn create_calendar(&self, summary: &str, tz: &str) -> R<CalendarInfo> {
        let body = serde_json::json!({ "summary": summary, "timeZone": tz });
        let (st, text) = self.send(reqwest::Method::POST, &format!("{BASE}/calendars"), Some(&body)).await?;
        Self::check(st, &text)?;
        serde_json::from_str(&text).map_err(|e| IntErr::Remote(e.to_string()))
    }

    /// Eine Seite des (inkrementellen) Abrufs; folgt `nextPageToken` bis zum Ende.
    pub async fn list(&self, cal: &str, sync_token: Option<&str>, time_min: &str) -> R<ListResult> {
        let mut items = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut url = format!("{BASE}/calendars/{}/events?maxResults=250&singleEvents=true&showDeleted=true", enc(cal));
            match sync_token {
                Some(t) => url.push_str(&format!("&syncToken={}", enc(t))),
                None => url.push_str(&format!("&timeMin={}", enc(time_min))),
            }
            if let Some(p) = &page {
                url.push_str(&format!("&pageToken={}", enc(p)));
            }
            let (st, text) = self.send(reqwest::Method::GET, &url, None).await?;
            if st == 410 {
                return Ok(ListResult::TokenExpired);
            }
            Self::check(st, &text)?;
            let v: Value = serde_json::from_str(&text).map_err(|e| IntErr::Remote(e.to_string()))?;
            if let Some(arr) = v.get("items").and_then(|i| i.as_array()) {
                items.extend(arr.iter().filter_map(|x| serde_json::from_value::<GEvent>(x.clone()).ok()));
            }
            page = v.get("nextPageToken").and_then(|t| t.as_str()).map(String::from);
            if page.is_none() {
                let next_sync_token = v.get("nextSyncToken").and_then(|t| t.as_str()).map(String::from);
                return Ok(ListResult::Ok(Page { items, next_sync_token }));
            }
        }
    }

    fn write_result(st: u16, text: &str) -> R<WriteResult> {
        match st {
            404 | 410 => Ok(WriteResult::Gone),
            409 => Ok(WriteResult::Conflict),
            _ => {
                Self::check(st, text)?;
                Ok(WriteResult::Ok(Box::new(serde_json::from_str(text).map_err(|e| IntErr::Remote(e.to_string()))?)))
            }
        }
    }

    pub async fn insert(&self, cal: &str, body: &Value) -> R<WriteResult> {
        let url = format!("{BASE}/calendars/{}/events", enc(cal));
        let (st, text) = self.send(reqwest::Method::POST, &url, Some(body)).await?;
        Self::write_result(st, &text)
    }

    pub async fn update(&self, cal: &str, id: &str, body: &Value) -> R<WriteResult> {
        let url = format!("{BASE}/calendars/{}/events/{}", enc(cal), enc(id));
        let (st, text) = self.send(reqwest::Method::PUT, &url, Some(body)).await?;
        Self::write_result(st, &text)
    }

    pub async fn delete(&self, cal: &str, id: &str) -> R<()> {
        let url = format!("{BASE}/calendars/{}/events/{}", enc(cal), enc(id));
        let (st, text) = self.send(reqwest::Method::DELETE, &url, None).await?;
        if matches!(st, 404 | 410) {
            return Ok(());
        }
        Self::check(st, &text)
    }
}

async fn tokio_sleep(d: Duration) {
    // Kein eigener Tokio-Feature-Satz nötig: blockierendes Warten in einem Hilfsthread.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retry_rules() {
        assert!(retryable(429, ""));
        assert!(retryable(503, ""));
        assert!(retryable(403, r#"{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}"#));
        assert!(!retryable(403, r#"{"error":{"errors":[{"reason":"forbidden"}]}}"#));
        assert!(!retryable(404, ""));
        assert!(backoff(0) >= Duration::from_secs(1) && backoff(3) >= Duration::from_secs(8));
    }
    #[test]
    fn noteforge_id_from_extended_properties() {
        let e: GEvent = serde_json::from_str(r#"{"id":"x","extendedProperties":{"private":{"noteforgeId":"event:1"}}}"#).unwrap();
        assert_eq!(e.noteforge_id(), Some("event:1"));
        assert_eq!(GEvent::default().noteforge_id(), None);
    }
}
