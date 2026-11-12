use super::*;
use crate::db::repo;

fn setup() -> (Db, String) {
    let db = Db::open_in_memory().unwrap();
    let email = "schueler@example.com".to_string();
    db.conn()
        .execute("INSERT INTO gcal_account (email, calendar_id, created_at) VALUES (?1, 'cal1', 0)", [&email])
        .unwrap();
    (db, email)
}

fn exam(conn: &Connection, start: i64) -> Event {
    repo::save_event(conn, Event {
        id: String::new(), subject_id: None, kind: "exam".into(), title: "Brüche".into(), start, end: None,
        note: String::new(), source: "manual".into(), remind_before: Some(1440), page_id: None, updated_at: 0,
    })
    .unwrap()
}

fn mark_pushed(conn: &Connection, email: &str, now: i64, remote_updated: i64) {
    for op in plan_account(conn, email, &Opts::default(), now).unwrap() {
        if let Op::Upsert(it) = op {
            save_link(conn, email, &it.key, &plan::google_id(email, &it.key), &it.hash(), remote_updated, false).unwrap();
        }
    }
}

fn gevent(key: &str, summary: &str, start: i64, updated: i64, status: &str) -> GEvent {
    serde_json::from_value(serde_json::json!({
        "id": "g1", "status": status, "summary": summary,
        "updated": chrono::DateTime::from_timestamp_millis(updated).unwrap().to_rfc3339(),
        "start": { "dateTime": plan::rfc3339(start) }, "end": { "dateTime": plan::rfc3339(start + 45 * 60_000) },
        "extendedProperties": { "private": { "noteforgeId": key } },
    }))
    .unwrap()
}

#[test]
fn queue_tracks_new_changed_and_deleted() {
    let (db, email) = setup();
    let c = db.conn();
    let now = now_ms();
    let e = exam(&c, now + 5 * DAY);
    let ops = plan_account(&c, &email, &Opts::default(), now).unwrap();
    assert_eq!(ops.len(), 1, "neue Klassenarbeit steht in der Warteschlange");
    mark_pushed(&c, &email, now, 0);
    assert!(plan_account(&c, &email, &Opts::default(), now).unwrap().is_empty(), "nach dem Übertragen nichts offen");

    // Offline geändert → wieder offen
    repo::save_event(&c, Event { title: "Prozent".into(), ..e.clone() }).unwrap();
    assert!(matches!(plan_account(&c, &email, &Opts::default(), now).unwrap()[0], Op::Upsert(_)));
    mark_pushed(&c, &email, now, 0);

    // Typ abgeschaltet → Löschen in Google
    let off = Opts { exams: false, ..Opts::default() };
    assert!(matches!(plan_account(&c, &email, &off, now).unwrap()[0], Op::Delete { .. }));

    // Lokal gelöscht → Löschen in Google
    repo::delete_event(&c, &e.id).unwrap();
    assert!(matches!(&plan_account(&c, &email, &Opts::default(), now).unwrap()[0], Op::Delete { key, .. } if key == &format!("event:{}", e.id)));
}

#[test]
fn google_change_is_applied_and_old_version_kept() {
    let (db, email) = setup();
    let c = db.conn();
    let now = now_ms();
    let e = exam(&c, now + 5 * DAY);
    mark_pushed(&c, &email, now, 1000);
    let key = format!("event:{}", e.id);
    let moved = e.start + DAY;
    let mut rep = GSyncReport::default();
    apply_remote(&c, &email, &Opts::default(), &gevent(&key, "KA – Bruchrechnung", moved, now + 10_000, "confirmed"), &mut rep).unwrap();
    let got = repo::get_event(&c, &e.id).unwrap().unwrap();
    assert_eq!(got.start, moved);
    assert_eq!(got.title, "Bruchrechnung");
    assert_eq!(rep.pulled, 1);
    let hist: i64 = c.query_row("SELECT COUNT(*) FROM event_history WHERE event_id=?1", [&e.id], |r| r.get(0)).unwrap();
    assert_eq!(hist, 1);
    assert!(plan_account(&c, &email, &Opts::default(), now).unwrap().is_empty(), "Übernahme erzeugt kein Echo");

    // Dasselbe Ereignis erneut (eigenes Echo) → nichts
    let mut rep2 = GSyncReport::default();
    apply_remote(&c, &email, &Opts::default(), &gevent(&key, "KA – Bruchrechnung", moved, now + 10_000, "confirmed"), &mut rep2).unwrap();
    assert_eq!(rep2.pulled, 0);
}

#[test]
fn last_change_wins_on_conflict() {
    let (db, email) = setup();
    let c = db.conn();
    let now = now_ms();
    let e = exam(&c, now + 5 * DAY);
    mark_pushed(&c, &email, now, 1000);
    let key = format!("event:{}", e.id);
    // Lokal später geändert als in Google → lokal gewinnt, Google-Version im Verlauf
    repo::save_event_at(&c, Event { title: "Lokal".into(), ..e.clone() }, now + 50_000).unwrap();
    let mut rep = GSyncReport::default();
    apply_remote(&c, &email, &Opts::default(), &gevent(&key, "KA – Google", e.start, now + 20_000, "confirmed"), &mut rep).unwrap();
    assert_eq!(repo::get_event(&c, &e.id).unwrap().unwrap().title, "Lokal");
    assert_eq!(rep.conflicts, 1);
    let origin: String = c.query_row("SELECT origin FROM event_history WHERE event_id=?1", [&e.id], |r| r.get(0)).unwrap();
    assert_eq!(origin, "google");
    assert_eq!(plan_account(&c, &email, &Opts::default(), now).unwrap().len(), 1, "lokale Version wird erneut übertragen");
}

#[test]
fn deletion_in_google_removes_local_event() {
    let (db, email) = setup();
    let c = db.conn();
    let now = now_ms();
    let e = exam(&c, now + 5 * DAY);
    mark_pushed(&c, &email, now, 1000);
    let mut rep = GSyncReport::default();
    apply_remote(&c, &email, &Opts::default(), &gevent(&format!("event:{}", e.id), "", e.start, now + 10_000, "cancelled"), &mut rep).unwrap();
    assert!(repo::get_event(&c, &e.id).unwrap().is_none());
    assert!(plan_account(&c, &email, &Opts::default(), now).unwrap().is_empty(), "nicht erneut anlegen");
}

#[test]
fn remote_events_with_exam_suggestion_and_adopt() {
    let (db, email) = setup();
    let c = db.conn();
    c.execute("INSERT INTO subject (id, name, color, icon, sort_order) VALUES ('m','Mathe','#2563eb','',0)", []).unwrap();
    let start = now_ms() + 3 * DAY;
    let g: GEvent = serde_json::from_value(serde_json::json!({
        "id": "x1", "status": "confirmed", "summary": "KA Mathe", "start": { "dateTime": plan::rfc3339(start) },
    }))
    .unwrap();
    store_remote(&c, &email, "cal1", &g).unwrap();
    let subs: Vec<(String, String)> = subjects(&c).unwrap().into_iter().map(|(id, (n, _))| (id, n)).collect();
    assert_eq!(plan::detect_exam("KA Mathe", &subs).unwrap().subject_id.as_deref(), Some("m"));
    let n: i64 = c.query_row("SELECT COUNT(*) FROM gcal_remote", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}
