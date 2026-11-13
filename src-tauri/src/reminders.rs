//! Erinnerungen per Windows-Benachrichtigung (SPEC §3, Phase 5).
//! Ein Hintergrund-Thread prüft regelmäßig fällige Termine – unabhängig davon,
//! welche Ansicht gerade offen ist.

use crate::db::{models::Event, repo, Db};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const INTERVAL: Duration = Duration::from_secs(20);
/// Termine, die seit mehr als 6 h laufen, werden beim Start nicht mehr gemeldet.
const GRACE_MS: i64 = 6 * 3600 * 1000;

/// Netzzeit statt Gerätezeit (SPEC §8.1).
fn now_ms() -> i64 {
    crate::clock::now_ms()
}

pub fn kind_label(kind: &str) -> &'static str {
    match kind {
        "exam" => "Klassenarbeit",
        "test" => "Test",
        "deadline" => "Abgabe",
        _ => "Termin",
    }
}

/// „in 30 Minuten“, „in 2 Stunden“, „morgen“ …
pub fn lead_text(minutes: i64) -> String {
    match minutes {
        m if m <= 0 => "jetzt".into(),
        1 => "in 1 Minute".into(),
        m if m < 60 => format!("in {m} Minuten"),
        60 => "in 1 Stunde".into(),
        m if m < 1440 => format!("in {} Stunden", m / 60),
        1440 => "morgen".into(),
        m => format!("in {} Tagen", m / 1440),
    }
}

fn body(conn: &rusqlite::Connection, e: &Event, now: i64) -> String {
    let subject: Option<String> = e.subject_id.as_ref().and_then(|id| {
        conn.query_row("SELECT name FROM subject WHERE id=?1", [id], |r| r.get(0)).ok()
    });
    let mins = ((e.start - now) as f64 / 60_000.0).round() as i64;
    let mut s = format!("{} {}", kind_label(&e.kind), lead_text(mins));
    if let Some(n) = subject {
        s.push_str(" · ");
        s.push_str(&n);
    }
    s
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("erinnerungen".into())
        .spawn(move || loop {
            let now = now_ms();
            let msgs: Vec<(String, String)> = {
                let db = app.state::<Db>();
                let conn = db.conn();
                // Erinnerungen im Assistenten/Einstellungen abschaltbar („app.reminders“ = "0")
                let enabled = crate::onboarding::app_setting(&conn, "app.reminders").as_deref() != Some("0");
                match repo::take_due_reminders(&conn, now, GRACE_MS) {
                    Ok(due) if enabled => due.iter().map(|e| (e.title.clone(), body(&conn, e, now))).collect(),
                    Ok(_) => Vec::new(),
                    Err(err) => {
                        eprintln!("Erinnerungen: {err}");
                        Vec::new()
                    }
                }
            };
            for (title, body) in msgs {
                if let Err(err) = app.notification().builder().title(title).body(body).show() {
                    eprintln!("Benachrichtigung fehlgeschlagen: {err}");
                }
            }
            std::thread::sleep(INTERVAL);
        })
        .expect("Erinnerungs-Thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn texts() {
        assert_eq!(lead_text(30), "in 30 Minuten");
        assert_eq!(lead_text(120), "in 2 Stunden");
        assert_eq!(lead_text(1440), "morgen");
        assert_eq!(lead_text(4320), "in 3 Tagen");
        assert_eq!(kind_label("exam"), "Klassenarbeit");
    }
}
