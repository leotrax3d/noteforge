//! Netzzeit (SPEC §8.1): eine gemeinsame Uhr für alle zeitabhängigen Funktionen (aktive Stunde, Pausen,
//! Erinnerungen, Nextcloud-Sync). Die Abweichung „Server − Gerät“ wird aus dem HTTP-`Date`-Kopf
//! gemessen – bei jedem Nextcloud-/WebUntis-Zugriff und zusätzlich alle 5 Minuten per Probe an die
//! eingerichteten Server. Der letzte Wert wird gespeichert, damit auch offline die korrigierte Zeit gilt.

use crate::db::{repo, Db};
use crate::integrations::{get_setting, set_setting};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Messung mit kleinster Laufzeit gewinnt; nach dieser Zeit zählt eine neue Messung immer.
const STALE_MS: i64 = 10 * 60_000;
pub const PROBE_INTERVAL: Duration = Duration::from_secs(5 * 60);
const KEY: &str = "clock";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// Serverzeit − Gerätezeit (ms)
    pub offset_ms: i64,
    pub rtt_ms: i64,
    /// Gerätezeit der Messung
    pub measured_at: i64,
}

static STATE: Mutex<Option<Sample>> = Mutex::new(None);

/// Neue Messung übernehmen, wenn sie genauer (kleinere Laufzeit) oder die alte veraltet ist.
pub fn accept(cur: Option<Sample>, new: Sample) -> Sample {
    match cur {
        Some(c) if new.measured_at - c.measured_at < STALE_MS && c.rtt_ms <= new.rtt_ms => c,
        _ => new,
    }
}

/// Messung aus Anfragezeitpunkten `t0`/`t1` (Gerät) und `Date`-Kopf (Server, Sekundenauflösung).
pub fn record(t0: i64, t1: i64, server_date_ms: i64) {
    // Date ist auf Sekunden abgeschnitten → +500 ms als Mitte.
    let s = Sample { offset_ms: server_date_ms + 500 - (t0 + t1) / 2, rtt_ms: t1 - t0, measured_at: t1 };
    let mut st = STATE.lock().unwrap_or_else(|e| e.into_inner());
    *st = Some(accept(*st, s));
}

pub fn offset() -> i64 {
    STATE.lock().unwrap_or_else(|e| e.into_inner()).map(|s| s.offset_ms).unwrap_or(0)
}

pub fn sample() -> Option<Sample> {
    *STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Korrigierte Zeit (ms seit Epoche).
pub fn now_ms() -> i64 {
    repo::now_ms() + offset()
}

/// `Date`-Kopf einer Antwort auswerten.
pub fn observe(t0: i64, resp: &reqwest::Response) {
    let t1 = repo::now_ms();
    if let Some(d) = resp
        .headers()
        .get(reqwest::header::DATE)
        .and_then(|v| v.to_str().ok())
        .and_then(crate::sync::dav::http_date)
    {
        record(t0, t1, d);
    }
}

/// Eingerichtete Server, deren Uhr wir fragen dürfen (keine Drittanbieter).
fn hosts(db: &Db) -> Vec<String> {
    let c = db.conn();
    let mut out = Vec::new();
    if let Ok(Some(u)) = get_setting::<crate::integrations::webuntis::UntisConfig>(&c, "untis") {
        out.push(format!("https://{}/WebUntis/", crate::integrations::webuntis::normalize_server(&u.server)));
    }
    if let Ok(Some(s)) = get_setting::<serde_json::Value>(&c, "sync.config")
        && let Some(server) = s.get("server").and_then(|v| v.as_str())
    {
        let base = server.trim().trim_end_matches('/');
        if !base.is_empty() {
            out.push(if base.starts_with("http") { base.to_string() } else { format!("https://{base}") });
        }
    }
    out
}

/// Einmal messen (erster erreichbarer Server). `true`, wenn gemessen wurde.
pub async fn probe(db: &Db) -> bool {
    let Ok(http) = reqwest::Client::builder().user_agent("Noteforge").timeout(Duration::from_secs(8)).build() else {
        return false;
    };
    for url in hosts(db) {
        let t0 = repo::now_ms();
        if let Ok(resp) = http.head(&url).send().await
            && resp.headers().contains_key(reqwest::header::DATE)
        {
            observe(t0, &resp);
            persist(db);
            return true;
        }
    }
    false
}

fn persist(db: &Db) {
    if let Some(s) = sample() {
        let _ = set_setting(&db.conn(), KEY, &s);
    }
}

/// Gespeicherte Abweichung laden (gilt offline weiter) und regelmäßig nachmessen.
pub fn spawn(app: AppHandle) {
    if let Ok(Some(s)) = get_setting::<Sample>(&app.state::<Db>().conn(), KEY) {
        let mut st = STATE.lock().unwrap_or_else(|e| e.into_inner());
        st.get_or_insert(s);
    }
    std::thread::Builder::new()
        .name("netzzeit".into())
        .spawn(move || loop {
            let db = app.state::<Db>();
            tauri::async_runtime::block_on(probe(&db));
            std::thread::sleep(PROBE_INTERVAL);
        })
        .expect("Netzzeit-Thread");
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockState {
    pub offset_ms: i64,
    pub measured_at: Option<i64>,
}

#[tauri::command]
pub fn clock_state() -> ClockState {
    let s = sample();
    ClockState { offset_ms: s.map(|s| s.offset_ms).unwrap_or(0), measured_at: s.map(|s| s.measured_at) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(off: i64, rtt: i64, at: i64) -> Sample {
        Sample { offset_ms: off, rtt_ms: rtt, measured_at: at }
    }

    #[test]
    fn keeps_most_precise_until_stale() {
        let a = s(1000, 50, 0);
        assert_eq!(accept(None, a), a);
        assert_eq!(accept(Some(a), s(900, 200, 60_000)), a, "ungenauere Messung verworfen");
        assert_eq!(accept(Some(a), s(950, 20, 60_000)).offset_ms, 950, "genauere gewinnt");
        assert_eq!(accept(Some(a), s(5000, 400, STALE_MS + 1)).offset_ms, 5000, "veraltet → neue gilt");
    }

    #[test]
    fn record_uses_midpoint() {
        // Gerät geht 3 s nach: Server sagt 10 000 (+500), Mitte der Anfrage = 7 000
        record(6_900, 7_100, 10_000);
        assert_eq!(offset(), 3_500);
    }
}
