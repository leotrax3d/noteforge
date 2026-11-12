//! Abbildung Noteforge → Google-Termin (rein, ohne Netzwerk; gut testbar).

use crate::db::models::Event;
use crate::integrations::Lesson;
use chrono::{DateTime, Local, NaiveDate, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Was pro Konto nach Google übertragen wird (SPEC §8.3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Opts {
    /// Klassenarbeiten und Tests
    pub exams: bool,
    /// Sonstige im Noteforge-Kalender angelegte Termine
    pub events: bool,
    /// Hausaufgaben mit Fälligkeit
    pub homework: bool,
    /// Hausaufgaben zur passenden Unterrichtsstunde statt ganztägig
    pub homework_at_lesson: bool,
    /// Moodle-Abgaben
    pub moodle: bool,
    /// Stundenplan aus WebUntis inkl. Ausfällen und Freistunden
    pub timetable: bool,
    /// Zusätzliche Erinnerungen 7/3/1 Tage vor Klassenarbeiten/Tests
    pub exam_reminders: bool,
    /// Klassenarbeiten in Google-Terminen erkennen und vorschlagen
    pub detect_exams: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            exams: true,
            events: true,
            homework: true,
            homework_at_lesson: false,
            moodle: true,
            timetable: false,
            exam_reminders: true,
            detect_exams: true,
        }
    }
}

/// Ein Termin, wie er in Google stehen soll.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub key: String,
    pub body: Value,
}

impl Item {
    pub fn hash(&self) -> String {
        hex(&Sha256::digest(self.body.to_string().as_bytes()))[..32].to_string()
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Feste Google-Termin-ID je Konto und lokalem Schlüssel (base32hex-Zeichen 0-9a-v): ein
/// wiederholtes Anlegen nach Verbindungsabbruch erzeugt keine Duplikate.
pub fn google_id(account: &str, key: &str) -> String {
    format!("nf{}", &hex(&Sha256::digest(format!("{account}\n{key}").as_bytes()))[..40])
}

/// Google-Terminfarben (colorId 1–11).
pub const GOOGLE_COLORS: [(&str, &str); 11] = [
    ("1", "#7986cb"), ("2", "#33b679"), ("3", "#8e24aa"), ("4", "#e67c73"), ("5", "#f6bf26"), ("6", "#f4511e"),
    ("7", "#039be5"), ("8", "#616161"), ("9", "#3f51b5"), ("10", "#0b8043"), ("11", "#d50000"),
];

fn rgb(hex: &str) -> Option<(i32, i32, i32)> {
    let h = hex.trim().trim_start_matches('#');
    let h = if h.len() == 3 { h.chars().flat_map(|c| [c, c]).collect::<String>() } else { h.to_string() };
    if h.len() != 6 {
        return None;
    }
    let p = |i: usize| i32::from_str_radix(&h[i..i + 2], 16).ok();
    Some((p(0)?, p(2)?, p(4)?))
}

/// Nächstliegende Google-Farbe zur Fachfarbe (gewichteter RGB-Abstand).
pub fn nearest_color(hex: &str) -> Option<&'static str> {
    let (r, g, b) = rgb(hex)?;
    GOOGLE_COLORS
        .iter()
        .min_by_key(|(_, c)| {
            let (r2, g2, b2) = rgb(c).unwrap_or_default();
            2 * (r - r2).pow(2) + 4 * (g - g2).pow(2) + 3 * (b - b2).pow(2)
        })
        .map(|(id, _)| *id)
}

pub fn kind_prefix(kind: &str) -> &'static str {
    match kind {
        "exam" => "KA",
        "test" => "Test",
        "deadline" => "Abgabe",
        _ => "",
    }
}

/// „KA Mathe – “ (mit Fach) bzw. „KA – “; leer bei sonstigen Terminen ohne Fach.
pub fn title_prefix(kind: &str, subject: Option<&str>) -> String {
    match (kind_prefix(kind), subject) {
        ("", Some(s)) => format!("{s} – "),
        ("", None) => String::new(),
        (p, Some(s)) => format!("{p} {s} – "),
        (p, None) => format!("{p} – "),
    }
}

/// Titel aus Google zurück in Noteforge: das vorangestellte „KA Mathe – “ entfernen.
pub fn strip_title(summary: &str, kind: &str, subject: Option<&str>) -> String {
    let s = summary.trim();
    let pre = title_prefix(kind, subject);
    if !pre.is_empty()
        && let Some(rest) = s.strip_prefix(pre.trim_end_matches([' ', '–']))
    {
        let rest = rest.trim_start_matches([' ', '–', '-', ':']).trim();
        if !rest.is_empty() {
            return rest.to_string();
        }
    }
    s.to_string()
}

pub fn rfc3339(ms: i64) -> String {
    Local.timestamp_millis_opt(ms).single().map(|t| t.to_rfc3339()).unwrap_or_default()
}

fn date_str(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn local_date(ms: i64) -> NaiveDate {
    Local.timestamp_millis_opt(ms).single().map(|t| t.date_naive()).unwrap_or_default()
}

fn is_midnight(ms: i64) -> bool {
    Local.timestamp_millis_opt(ms).single().is_some_and(|t| t.hour() == 0 && t.minute() == 0)
}

/// Ganztägig, wenn Beginn um 0:00 und kein Ende.
pub fn times(start: i64, end: Option<i64>, default_min: i64) -> (Value, Value) {
    if end.is_none() && is_midnight(start) {
        let d = local_date(start);
        return (json!({ "date": date_str(d) }), json!({ "date": date_str(d.succ_opt().unwrap_or(d)) }));
    }
    let end = end.filter(|e| *e > start).unwrap_or(start + default_min * 60_000);
    (json!({ "dateTime": rfc3339(start) }), json!({ "dateTime": rfc3339(end) }))
}

/// Google-Zeit → (ms, ganztägig).
pub fn parse_time(t: &super::api::EventTime) -> Option<(i64, bool)> {
    if let Some(dt) = &t.date_time {
        return DateTime::parse_from_rfc3339(dt).ok().map(|d| (d.timestamp_millis(), false));
    }
    let d = NaiveDate::parse_from_str(t.date.as_deref()?, "%Y-%m-%d").ok()?;
    let ms = Local.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).earliest()?.timestamp_millis();
    Some((ms, true))
}

pub fn parse_updated(s: &str) -> i64 {
    DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).unwrap_or(0)
}

/// Erinnerungen: Noteforge-Erinnerung plus optional 7/3/1 Tage (Google erlaubt höchstens 5, max. 4 Wochen).
pub fn reminders(base: Option<i64>, extra_days: &[i64]) -> Value {
    let mut m: Vec<i64> = base.into_iter().chain(extra_days.iter().map(|d| d * 1440)).filter(|x| (0..=40320).contains(x)).collect();
    m.sort_unstable_by(|a, b| b.cmp(a));
    m.dedup();
    m.truncate(5);
    let overrides: Vec<Value> = m.iter().map(|x| json!({ "method": "popup", "minutes": x })).collect();
    json!({ "useDefault": false, "overrides": overrides })
}

fn body(key: &str, summary: String, description: String, (start, end): (Value, Value), color: Option<&str>, reminders: Value, location: &str) -> Value {
    let mut b = json!({
        "summary": summary,
        "description": description,
        "start": start,
        "end": end,
        "reminders": reminders,
        "extendedProperties": { "private": { "noteforgeId": key } },
    });
    if let Some(c) = color {
        b["colorId"] = json!(c);
    }
    if !location.is_empty() {
        b["location"] = json!(location);
    }
    b
}

pub struct SubjectInfo<'a> {
    pub name: &'a str,
    pub color: &'a str,
}

fn link_line(page_id: Option<&str>, subject_id: Option<&str>) -> String {
    match (page_id, subject_id) {
        (Some(p), _) => format!("Blatt in Noteforge öffnen: noteforge://page/{p}"),
        (None, Some(s)) => format!("Fach in Noteforge öffnen: noteforge://subject/{s}"),
        _ => "In Noteforge öffnen: noteforge://calendar".into(),
    }
}

fn describe(note: &str, link: String) -> String {
    let n = note.trim();
    if n.is_empty() { link } else { format!("{n}\n\n{link}") }
}

/// Kalendertermin (Klassenarbeit, Test, Abgabe, sonstiger Termin).
pub fn event_item(e: &Event, subject: Option<SubjectInfo>, opts: &Opts) -> Item {
    let key = format!("event:{}", e.id);
    let summary = format!("{}{}", title_prefix(&e.kind, subject.as_ref().map(|s| s.name)), e.title);
    let extra: &[i64] = if opts.exam_reminders && matches!(e.kind.as_str(), "exam" | "test") { &[7, 3, 1] } else { &[] };
    let color = subject.as_ref().and_then(|s| nearest_color(s.color));
    let dur = if matches!(e.kind.as_str(), "exam" | "test") { 45 } else { 60 };
    Item {
        body: body(&key, summary, describe(&e.note, link_line(e.page_id.as_deref(), e.subject_id.as_deref())),
            times(e.start, e.end, dur), color, reminders(e.remind_before, extra), ""),
        key,
    }
}

pub struct HomeworkIn<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub note: &'a str,
    pub due: i64,
    pub subject_id: Option<&'a str>,
}

/// Hausaufgabe: ganztägig am Fälligkeitstag oder zur passenden Stunde.
pub fn homework_item(h: &HomeworkIn, subject: Option<SubjectInfo>, lesson: Option<(i64, i64)>) -> Item {
    let key = format!("hw:{}", h.id);
    let summary = match &subject {
        Some(s) => format!("HA {} – {}", s.name, h.title),
        None => format!("HA – {}", h.title),
    };
    let t = match lesson {
        Some((a, b)) => times(a, Some(b), 45),
        None => times(local_midnight(h.due), None, 0),
    };
    let link = match h.subject_id {
        Some(s) => format!("Fach in Noteforge öffnen: noteforge://subject/{s}"),
        None => "In Noteforge öffnen: noteforge://homework".into(),
    };
    let color = subject.as_ref().and_then(|s| nearest_color(s.color));
    // Erinnerung am Vorabend (ganztägig: Vortag 15 Uhr)
    Item { body: body(&key, summary, describe(h.note, link), t, color, reminders(Some(if lesson.is_some() { 720 } else { 540 }), &[]), ""), key }
}

pub fn local_midnight(ms: i64) -> i64 {
    let d = local_date(ms);
    Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap_or_default()).earliest().map(|t| t.timestamp_millis()).unwrap_or(ms)
}

/// Stundenplan: Stunden (ausgefallene als „Entfällt: …“) und Freistunden (Lücken ≥ 30 min).
pub fn timetable_items(lessons: &[Lesson], subject: impl Fn(&Lesson) -> Option<(String, String)>) -> Vec<Item> {
    let mut out = Vec::new();
    for l in lessons {
        let (name, color) = subject(l).unwrap_or_else(|| {
            (if l.subject_long.is_empty() { l.subject_name.clone() } else { l.subject_long.clone() }, String::new())
        });
        let name = if name.is_empty() { "Unterricht".to_string() } else { name };
        let key = format!("lesson:{}:{}", l.id, l.start);
        let summary = match l.state.as_str() {
            "cancelled" => format!("Entfällt: {name}"),
            "irregular" => format!("{name} (Vertretung)"),
            _ => name,
        };
        let mut desc = [l.teachers.as_str(), l.info.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n");
        if !desc.is_empty() {
            desc.push_str("\n\n");
        }
        desc.push_str("Stundenplan aus WebUntis · noteforge://calendar");
        let color = if l.state == "cancelled" { Some("8") } else { nearest_color(&color) };
        out.push(Item {
            body: body(&key, summary, desc, times(l.start, Some(l.end), 45), color, reminders(None, &[]), &l.rooms),
            key,
        });
    }
    // Freistunden: Lücken zwischen stattfindenden Stunden desselben Tages
    let mut held: Vec<&Lesson> = lessons.iter().filter(|l| l.state != "cancelled").collect();
    held.sort_by_key(|l| l.start);
    for w in held.windows(2) {
        let (a, b) = (w[0], w[1]);
        if local_date(a.start) == local_date(b.start) && b.start - a.end >= 30 * 60_000 {
            let key = format!("free:{}", a.end);
            out.push(Item {
                body: body(&key, "Freistunde".into(), "Stundenplan aus WebUntis · noteforge://calendar".into(),
                    times(a.end, Some(b.start), 45), Some("2"), reminders(None, &[]), ""),
                key,
            });
        }
    }
    out.dedup_by(|a, b| a.key == b.key);
    out
}

// ---------- Klassenarbeiten in Google-Terminen erkennen ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    #[serde(rename = "type")]
    pub kind: String,
    pub subject_id: Option<String>,
}

fn fold(s: &str) -> String {
    s.to_lowercase().replace('ä', "a").replace('ö', "o").replace('ü', "u").replace('ß', "ss")
}

/// Häufige Fach-Kürzel zusätzlich zum Fachnamen.
fn aliases(name: &str) -> Vec<String> {
    let n = fold(name);
    let mut v = vec![n.clone()];
    let extra: &[(&str, &[&str])] = &[
        ("mathe", &["mathematik", "ma", "m"]), ("mathematik", &["mathe", "ma", "m"]), ("deutsch", &["de", "d"]),
        ("englisch", &["en", "e", "english"]), ("franzosisch", &["franz", "fr", "f"]), ("latein", &["la", "l"]),
        ("physik", &["ph"]), ("chemie", &["ch"]), ("biologie", &["bio", "bi"]), ("geschichte", &["ge", "g"]),
        ("erdkunde", &["geo", "ek"]), ("geographie", &["geo", "ek"]), ("informatik", &["inf", "info"]),
        ("religion", &["reli", "rel"]), ("musik", &["mu"]), ("kunst", &["bk", "ku"]), ("sport", &["sp"]),
        ("gemeinschaftskunde", &["gk", "gmk"]), ("wirtschaft", &["wbs", "wi"]), ("spanisch", &["sp", "spa"]),
    ];
    for (k, al) in extra {
        if n == *k || n.starts_with(k) {
            v.extend(al.iter().map(|a| a.to_string()));
        }
    }
    v
}

/// „KA Mathe“, „Klassenarbeit Deutsch“, „Englisch-Test“ … → Vorschlag mit Typ und Fach.
pub fn detect_exam(title: &str, subjects: &[(String, String)]) -> Option<Suggestion> {
    let t = fold(title);
    let words: Vec<&str> = t.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let kind = if words.iter().any(|w| matches!(*w, "ka" | "klassenarbeit" | "klausur" | "schulaufgabe")) || t.contains("klassenarbeit") {
        "exam"
    } else if words.iter().any(|w| matches!(*w, "test" | "lk" | "lernkontrolle" | "ex" | "stegreifaufgabe")) || t.contains("test ") || t.ends_with("test") {
        "test"
    } else {
        return None;
    };
    let subject = subjects.iter().find(|(_, name)| {
        aliases(name).iter().any(|a| {
            if a.len() <= 2 { words.contains(&a.as_str()) } else { words.iter().any(|w| w.starts_with(a.as_str())) || t.contains(a.as_str()) }
        })
    });
    subject.map(|(id, _)| Suggestion { kind: kind.into(), subject_id: Some(id.clone()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, start: i64) -> Event {
        Event {
            id: "e1".into(), subject_id: Some("s1".into()), kind: kind.into(), title: "Brüche".into(), start, end: None,
            note: "Kapitel 3".into(), source: "manual".into(), remind_before: Some(1440), page_id: Some("p1".into()), updated_at: 0,
        }
    }

    #[test]
    fn exam_title_color_reminders_link() {
        let start = crate::integrations::local_ms(2026, 12, 3, 8, 0).unwrap();
        let it = event_item(&ev("exam", start), Some(SubjectInfo { name: "Mathe", color: "#2563eb" }), &Opts::default());
        assert_eq!(it.key, "event:e1");
        assert_eq!(it.body["summary"], "KA Mathe – Brüche");
        assert!(it.body["description"].as_str().unwrap().contains("noteforge://page/p1"));
        assert_eq!(it.body["extendedProperties"]["private"]["noteforgeId"], "event:e1");
        let mins: Vec<i64> = it.body["reminders"]["overrides"].as_array().unwrap().iter().map(|o| o["minutes"].as_i64().unwrap()).collect();
        assert_eq!(mins, vec![10080, 4320, 1440]);
        assert!(it.body["colorId"].is_string());
        assert!(it.body["start"]["dateTime"].is_string());
    }

    #[test]
    fn all_day_without_time() {
        let start = crate::integrations::local_ms(2026, 12, 3, 0, 0).unwrap();
        let it = event_item(&ev("test", start), None, &Opts { exam_reminders: false, ..Opts::default() });
        assert_eq!(it.body["start"]["date"], "2026-12-03");
        assert_eq!(it.body["end"]["date"], "2026-12-04");
        assert_eq!(it.body["summary"], "Test – Brüche");
        let (ms, all_day) = parse_time(&serde_json::from_value(it.body["start"].clone()).unwrap()).unwrap();
        assert!(all_day);
        assert_eq!(ms, start);
    }

    #[test]
    fn hash_changes_with_content() {
        let a = event_item(&ev("exam", 0), None, &Opts::default());
        let b = event_item(&Event { title: "Prozent".into(), ..ev("exam", 0) }, None, &Opts::default());
        assert_eq!(a.hash(), event_item(&ev("exam", 0), None, &Opts::default()).hash());
        assert_ne!(a.hash(), b.hash());
    }

    #[test]
    fn titles_round_trip() {
        assert_eq!(strip_title("KA Mathe – Brüche", "exam", Some("Mathe")), "Brüche");
        assert_eq!(strip_title("KA Mathe - Prozentrechnung", "exam", Some("Mathe")), "Prozentrechnung");
        assert_eq!(strip_title("Ganz neuer Titel", "exam", Some("Mathe")), "Ganz neuer Titel");
        assert_eq!(strip_title("Elternabend", "other", None), "Elternabend");
    }

    #[test]
    fn colors() {
        assert_eq!(nearest_color("#d50000"), Some("11"));
        assert_eq!(nearest_color("#0b8043"), Some("10"));
        assert_eq!(nearest_color("#f00"), Some("11"));
        assert_eq!(nearest_color("kaputt"), None);
    }

    #[test]
    fn ids_are_valid_base32hex_and_stable() {
        let id = google_id("a@b.de", "event:1");
        assert_eq!(id, google_id("a@b.de", "event:1"));
        assert_ne!(id, google_id("c@b.de", "event:1"));
        assert!(id.len() >= 5 && id.chars().all(|c| c.is_ascii_digit() || ('a'..='v').contains(&c)));
    }

    #[test]
    fn exam_detection() {
        let subs = vec![("m".to_string(), "Mathe".to_string()), ("d".to_string(), "Deutsch".to_string()), ("e".to_string(), "Englisch".to_string())];
        assert_eq!(detect_exam("KA Mathe", &subs), Some(Suggestion { kind: "exam".into(), subject_id: Some("m".into()) }));
        assert_eq!(detect_exam("Klassenarbeit Deutsch (Erörterung)", &subs).unwrap().subject_id.as_deref(), Some("d"));
        assert_eq!(detect_exam("Englisch-Test unit 4", &subs).unwrap().kind, "test");
        assert_eq!(detect_exam("Vokabeltest E", &subs).unwrap().subject_id.as_deref(), Some("e"));
        assert_eq!(detect_exam("Fußballtraining", &subs), None);
        assert_eq!(detect_exam("KA", &subs), None, "ohne Fach kein Vorschlag");
    }

    #[test]
    fn timetable_with_cancel_and_free_period() {
        let at = |h: u32, m: u32| crate::integrations::local_ms(2026, 12, 1, h, m).unwrap();
        let l = |id: i64, a: i64, b: i64, state: &str| Lesson {
            id, start: a, end: b, untis_subject_id: None, subject_name: "M".into(), subject_long: "Mathematik".into(),
            rooms: "R1".into(), teachers: String::new(), state: state.into(), info: String::new(), subject_id: None,
        };
        let items = timetable_items(&[l(1, at(8, 0), at(8, 45), "normal"), l(2, at(8, 50), at(9, 35), "cancelled"), l(3, at(9, 40), at(10, 25), "normal")], |_| None);
        let titles: Vec<&str> = items.iter().map(|i| i.body["summary"].as_str().unwrap()).collect();
        assert!(titles.contains(&"Entfällt: Mathematik"));
        assert!(titles.contains(&"Freistunde"));
        assert_eq!(items[0].body["location"], "R1");
    }

    #[test]
    fn reminder_limits() {
        let r = reminders(Some(1440), &[7, 3, 1, 30]);
        let mins: Vec<i64> = r["overrides"].as_array().unwrap().iter().map(|o| o["minutes"].as_i64().unwrap()).collect();
        assert_eq!(mins, vec![10080, 4320, 1440], "30 Tage liegt über dem Google-Maximum, 1 Tag doppelt");
    }
}
