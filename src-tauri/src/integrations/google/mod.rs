//! Google-Kalender (SPEC §8.3): OAuth (PKCE + Loopback), Noteforge → Google, Google → Noteforge.
//! Mehrere Konten; Refresh-Tokens nur im Credential Manager, Zuordnung über
//! `extendedProperties.private.noteforgeId` und die gerätelokale Tabelle `gcal_link`.

pub mod api;
pub mod oauth;
pub mod plan;

use super::{get_setting, secrets, set_setting, IntErr};
use crate::db::{models::Event, repo, Db};
use api::{Api, GEvent, ListResult, WriteResult};
use plan::{Item, Opts, SubjectInfo};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, State};

type R<T> = Result<T, IntErr>;
type S<'a> = State<'a, Db>;

pub const CALENDAR_NAME: &str = "Noteforge – Schule";
const CLIENT_ID_KEY: &str = "google.client_id";
/// Höchstens so viele Schreibzugriffe pro Durchlauf (Rest beim nächsten Mal) – schont das Kontingent.
const MAX_WRITES: usize = 150;
const DAY: i64 = 86_400_000;

fn now_ms() -> i64 {
    chrono::Local::now().timestamp_millis()
}

// ---------- Client-ID ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub client_id: String,
    pub has_secret: bool,
}

fn client(conn: &Connection) -> R<oauth::Client> {
    let id: String = get_setting(conn, CLIENT_ID_KEY)?.unwrap_or_default();
    if id.trim().is_empty() {
        return Err(IntErr::Other("Bitte zuerst in den Einstellungen eine Google-Client-ID eintragen".into()));
    }
    Ok(oauth::Client { id, secret: secrets::get(oauth::CLIENT_SECRET_KEY).map_err(IntErr::Other)? })
}

#[tauri::command]
pub fn gcal_client(db: S) -> R<ClientConfig> {
    Ok(ClientConfig {
        client_id: get_setting(&db.conn(), CLIENT_ID_KEY)?.unwrap_or_default(),
        has_secret: secrets::get(oauth::CLIENT_SECRET_KEY).map_err(IntErr::Other)?.is_some(),
    })
}

/// Client-ID (SQLite, nicht geheim) und optional Client-Secret (Credential Manager) speichern.
#[tauri::command]
pub fn gcal_set_client(db: S, client_id: String, client_secret: Option<String>) -> R<()> {
    let id = client_id.trim();
    if !id.is_empty() && !id.ends_with(".apps.googleusercontent.com") {
        return Err(IntErr::Other("Die Client-ID endet auf „.apps.googleusercontent.com“".into()));
    }
    set_setting(&db.conn(), CLIENT_ID_KEY, &id)?;
    match client_secret.as_deref().map(str::trim) {
        Some("") => secrets::delete(oauth::CLIENT_SECRET_KEY).map_err(IntErr::Other)?,
        Some(s) => secrets::set(oauth::CLIENT_SECRET_KEY, s).map_err(IntErr::Other)?,
        None => {}
    }
    Ok(())
}

// ---------- Konten ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceCal {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: String,
    pub calendar_id: Option<String>,
    pub calendar_name: String,
    pub opts: Opts,
    pub sources: Vec<SourceCal>,
    pub last_sync: Option<i64>,
    pub last_error: Option<String>,
    /// Lokale Änderungen, die noch nicht in Google sind (Offline-Warteschlange).
    pub pending: usize,
}

fn accounts_db(conn: &Connection) -> R<Vec<Account>> {
    let mut st = conn.prepare(
        "SELECT email, calendar_id, calendar_name, opts, last_sync, last_error FROM gcal_account ORDER BY created_at",
    )?;
    let rows = st.query_map([], |r| {
        let opts: String = r.get(3)?;
        Ok(Account {
            email: r.get(0)?,
            calendar_id: r.get(1)?,
            calendar_name: r.get(2)?,
            opts: serde_json::from_str(&opts).unwrap_or_default(),
            sources: Vec::new(),
            last_sync: r.get(4)?,
            last_error: r.get(5)?,
            pending: 0,
        })
    })?;
    let mut out: Vec<Account> = rows.collect::<rusqlite::Result<_>>()?;
    for a in &mut out {
        let mut st = conn.prepare("SELECT calendar_id, name, color FROM gcal_source WHERE account=?1 ORDER BY name")?;
        a.sources = st
            .query_map([&a.email], |r| Ok(SourceCal { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? }))?
            .collect::<rusqlite::Result<_>>()?;
        if a.calendar_id.is_some() {
            a.pending = plan_account(conn, &a.email, &a.opts, now_ms()).map(|p| p.len()).unwrap_or(0);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn gcal_status(db: S) -> R<Vec<Account>> {
    accounts_db(&db.conn())
}

async fn api_for(db: &Db, email: &str) -> R<Api> {
    let c = client(&db.conn())?;
    Ok(Api::new(oauth::access_token(&c, email).await?))
}

/// Anmeldung im Standardbrowser; legt das Konto an (Kalender wird danach mit `gcal_configure` gewählt).
#[tauri::command]
pub async fn gcal_login(app: AppHandle, db: S<'_>) -> R<String> {
    use tauri_plugin_opener::OpenerExt;
    let c = client(&db.conn())?;
    let t = oauth::login(&c, |u| app.opener().open_url(u, None::<&str>).map_err(|e| e.to_string())).await?;
    let email = Api::new(t.access_token.clone()).primary_id().await?;
    if let Some(r) = &t.refresh_token {
        secrets::set(&oauth::secret_key(&email), r).map_err(IntErr::Other)?;
    }
    oauth::remember(&email, &t);
    db.conn().execute(
        "INSERT INTO gcal_account (email, created_at) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET last_error=NULL",
        params![email, now_ms()],
    )?;
    Ok(email)
}

#[tauri::command]
pub async fn gcal_calendars(db: S<'_>, email: String) -> R<Vec<api::CalendarInfo>> {
    api_for(&db, &email).await?.calendars().await
}

/// Zielkalender wählen (`None` = eigenen „Noteforge – Schule“ anlegen) und Optionen/Quellen speichern.
#[tauri::command]
pub async fn gcal_configure(db: S<'_>, email: String, calendar_id: Option<String>, opts: Opts, sources: Vec<SourceCal>) -> R<()> {
    let current: Option<(Option<String>, String)> = db
        .conn()
        .query_row("SELECT calendar_id, calendar_name FROM gcal_account WHERE email=?1", [&email], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((cur_id, cur_name)) = current else {
        return Err(IntErr::Other("Konto nicht gefunden".into()));
    };
    let (cal_id, cal_name) = match calendar_id {
        Some(id) if Some(&id) == cur_id.as_ref() => (id, cur_name),
        Some(id) => {
            let api = api_for(&db, &email).await?;
            let name = api.calendars().await?.into_iter().find(|c| c.id == id).map(|c| c.summary).unwrap_or_default();
            (id, name)
        }
        None => match cur_id.filter(|_| cur_name == CALENDAR_NAME) {
            Some(id) => (id, cur_name),
            None => {
                let api = api_for(&db, &email).await?;
                let existing = api.calendars().await?.into_iter().find(|c| c.summary == CALENDAR_NAME && c.access_role == "owner");
                let cal = match existing {
                    Some(c) => c,
                    None => api.create_calendar(CALENDAR_NAME, "Europe/Berlin").await?,
                };
                (cal.id, CALENDAR_NAME.to_string())
            }
        },
    };
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let changed_target = tx
        .query_row("SELECT calendar_id IS NOT ?2 FROM gcal_account WHERE email=?1", params![email, cal_id], |r| r.get::<_, bool>(0))?;
    if changed_target {
        // Neuer Zielkalender: Zuordnungen und Abrufstand neu aufbauen
        tx.execute("DELETE FROM gcal_link WHERE account=?1", [&email])?;
        tx.execute("UPDATE gcal_account SET sync_token=NULL WHERE email=?1", [&email])?;
        tx.execute("DELETE FROM gcal_remote WHERE account=?1 AND calendar_id NOT IN (SELECT calendar_id FROM gcal_source WHERE account=?1)", [&email])?;
    }
    tx.execute(
        "UPDATE gcal_account SET calendar_id=?2, calendar_name=?3, opts=?4 WHERE email=?1",
        params![email, cal_id, cal_name, serde_json::to_string(&opts).unwrap_or_default()],
    )?;
    let keep: HashSet<&str> = sources.iter().map(|s| s.id.as_str()).filter(|id| *id != cal_id).collect();
    let old: Vec<String> = {
        let mut st = tx.prepare("SELECT calendar_id FROM gcal_source WHERE account=?1")?;
        st.query_map([&email], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    for id in old.iter().filter(|id| !keep.contains(id.as_str())) {
        tx.execute("DELETE FROM gcal_source WHERE account=?1 AND calendar_id=?2", params![email, id])?;
        tx.execute("DELETE FROM gcal_remote WHERE account=?1 AND calendar_id=?2", params![email, id])?;
    }
    for s in sources.iter().filter(|s| keep.contains(s.id.as_str())) {
        tx.execute(
            "INSERT INTO gcal_source (account, calendar_id, name, color) VALUES (?1,?2,?3,?4)
             ON CONFLICT(account, calendar_id) DO UPDATE SET name=excluded.name, color=excluded.color",
            params![email, s.id, s.name, s.color],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Abmelden: Zugriff bei Google widerrufen, Refresh-Token und lokale Zuordnungen löschen.
/// Mit `remove_events` werden vorher die von Noteforge angelegten Termine in Google entfernt.
#[tauri::command]
pub async fn gcal_disconnect(db: S<'_>, email: String, remove_events: bool) -> R<()> {
    if remove_events {
        let target: Option<String> = db
            .conn()
            .query_row("SELECT calendar_id FROM gcal_account WHERE email=?1", [&email], |r| r.get(0))
            .optional()?
            .flatten();
        if let (Some(cal), Ok(api)) = (target, api_for(&db, &email).await) {
            let ids: Vec<String> = {
                let c = db.conn();
                let mut st = c.prepare("SELECT google_id FROM gcal_link WHERE account=?1 AND deleted=0")?;
                st.query_map([&email], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
            };
            for id in ids {
                let _ = api.delete(&cal, &id).await;
            }
        }
    }
    oauth::revoke(&email).await;
    secrets::delete(&oauth::secret_key(&email)).map_err(IntErr::Other)?;
    db.conn().execute("DELETE FROM gcal_account WHERE email=?1", [&email])?;
    Ok(())
}

// ---------- Plan: was muss nach Google? ----------

#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Upsert(Item),
    Delete { key: String, google_id: String },
}

impl Op {
    fn key(&self) -> &str {
        match self {
            Op::Upsert(i) => &i.key,
            Op::Delete { key, .. } => key,
        }
    }
}

struct Link {
    google_id: String,
    hash: String,
    remote_updated: i64,
    deleted: bool,
}

fn links(conn: &Connection, account: &str) -> R<HashMap<String, Link>> {
    let mut st = conn.prepare("SELECT local_key, google_id, hash, remote_updated, deleted FROM gcal_link WHERE account=?1")?;
    let rows = st.query_map([account], |r| {
        Ok((r.get::<_, String>(0)?, Link { google_id: r.get(1)?, hash: r.get(2)?, remote_updated: r.get(3)?, deleted: r.get(4)? }))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn subjects(conn: &Connection) -> R<HashMap<String, (String, String)>> {
    let mut st = conn.prepare("SELECT id, name, color FROM subject")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn subject_info<'a>(subs: &'a HashMap<String, (String, String)>, id: Option<&str>) -> Option<SubjectInfo<'a>> {
    id.and_then(|i| subs.get(i)).map(|(n, c)| SubjectInfo { name: n, color: c })
}

/// Alle Termine, die laut Optionen in Google stehen sollen (ab 30 Tagen in der Vergangenheit).
pub fn desired(conn: &Connection, opts: &Opts, now: i64) -> R<Vec<Item>> {
    let from = now - 30 * DAY;
    let subs = subjects(conn)?;
    let mut out = Vec::new();
    for e in repo::list_events(conn, from, i64::MAX / 2)? {
        let on = match (e.source.as_str(), e.kind.as_str()) {
            ("moodle", _) => opts.moodle,
            (_, "exam" | "test") => opts.exams,
            _ => opts.events,
        };
        if on {
            out.push(plan::event_item(&e, subject_info(&subs, e.subject_id.as_deref()), opts));
        }
    }
    if opts.homework {
        let mut st = conn.prepare(
            "SELECT id, title, note, due, subject_id FROM homework
             WHERE source='manual' AND dismissed=0 AND done_at IS NULL AND due IS NOT NULL AND due >= ?1",
        )?;
        let rows: Vec<(String, String, String, i64, Option<String>)> =
            st.query_map([from], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<rusqlite::Result<_>>()?;
        for (id, title, note, due, sid) in rows {
            let lesson = if opts.homework_at_lesson && sid.is_some() {
                let day = plan::local_midnight(due);
                super::list_lessons_db(conn, day, day + DAY)?
                    .into_iter()
                    .find(|l| l.subject_id == sid && l.state != "cancelled")
                    .map(|l| (l.start, l.end))
            } else {
                None
            };
            let h = plan::HomeworkIn { id: &id, title: &title, note: &note, due, subject_id: sid.as_deref() };
            out.push(plan::homework_item(&h, subject_info(&subs, sid.as_deref()), lesson));
        }
    }
    if opts.timetable {
        let lessons = super::list_lessons_db(conn, from.max(now - 7 * DAY), i64::MAX / 2)?;
        out.extend(plan::timetable_items(&lessons, |l| {
            l.subject_id.as_ref().and_then(|s| subs.get(s)).map(|(n, c)| (n.clone(), c.clone()))
        }));
    }
    Ok(out)
}

/// Existiert der lokale Eintrag noch, liegt aber außerhalb des Abgleich-Fensters? Dann bleibt der Google-Termin stehen.
fn outside_window(conn: &Connection, key: &str, now: i64) -> R<bool> {
    let cutoff = now - 30 * DAY;
    let Some((kind, rest)) = key.split_once(':') else { return Ok(false) };
    Ok(match kind {
        "event" => conn
            .query_row("SELECT start < ?2 FROM event WHERE id=?1", params![rest, cutoff], |r| r.get::<_, bool>(0))
            .optional()?
            .unwrap_or(false),
        "lesson" | "free" => rest.rsplit(':').next().and_then(|s| s.parse::<i64>().ok()).is_some_and(|t| t < now),
        _ => false,
    })
}

/// Ausstehende Schreibzugriffe für ein Konto (geänderte/neue Termine, zu löschende).
pub fn plan_account(conn: &Connection, account: &str, opts: &Opts, now: i64) -> R<Vec<Op>> {
    let want = desired(conn, opts, now)?;
    let have = links(conn, account)?;
    let mut ops = Vec::new();
    let keys: HashSet<String> = want.iter().map(|i| i.key.clone()).collect();
    for it in want {
        match have.get(&it.key) {
            Some(l) if l.hash == it.hash() => {} // unverändert (auch: in Google gelöscht und lokal unverändert)
            _ => ops.push(Op::Upsert(it)),
        }
    }
    for (key, l) in &have {
        if !keys.contains(key) && !l.deleted && !outside_window(conn, key, now)? {
            ops.push(Op::Delete { key: key.clone(), google_id: l.google_id.clone() });
        }
    }
    Ok(ops)
}

fn save_link(conn: &Connection, account: &str, key: &str, gid: &str, hash: &str, remote_updated: i64, deleted: bool) -> R<()> {
    conn.execute(
        "INSERT INTO gcal_link (account, local_key, google_id, hash, remote_updated, deleted) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(account, local_key) DO UPDATE SET google_id=excluded.google_id, hash=excluded.hash,
           remote_updated=excluded.remote_updated, deleted=excluded.deleted",
        params![account, key, gid, hash, remote_updated, deleted],
    )?;
    Ok(())
}

// ---------- Google → Noteforge ----------

fn snapshot(conn: &Connection, event_id: &str, ev: &serde_json::Value, origin: &str, reason: &str) -> R<()> {
    conn.execute(
        "INSERT INTO event_history (event_id, snapshot, origin, reason, at) VALUES (?1,?2,?3,?4,?5)",
        params![event_id, ev.to_string(), origin, reason, now_ms()],
    )?;
    Ok(())
}

fn event_json(e: &Event) -> serde_json::Value {
    serde_json::to_value(e).unwrap_or_default()
}

fn store_remote(conn: &Connection, account: &str, cal: &str, g: &GEvent) -> R<()> {
    if g.status == "cancelled" {
        conn.execute("DELETE FROM gcal_remote WHERE account=?1 AND calendar_id=?2 AND id=?3", params![account, cal, g.id])?;
        return Ok(());
    }
    let Some((start, all_day)) = plan::parse_time(&g.start) else { return Ok(()) };
    let end = plan::parse_time(&g.end).map(|(e, _)| e);
    conn.execute(
        r#"INSERT INTO gcal_remote (account, calendar_id, id, title, start, "end", all_day, location) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
           ON CONFLICT(account, calendar_id, id) DO UPDATE SET title=excluded.title, start=excluded.start,
             "end"=excluded."end", all_day=excluded.all_day, location=excluded.location"#,
        params![account, cal, g.id, g.summary, start, end, all_day, g.location],
    )?;
    Ok(())
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GSyncReport {
    pub pushed: usize,
    pub deleted: usize,
    pub pulled: usize,
    pub conflicts: usize,
    pub pending: usize,
    pub errors: Vec<String>,
    pub skipped: bool,
}

/// Änderung aus Google an einem Noteforge-Termin übernehmen. „Letzte Änderung gewinnt“; die
/// unterlegene Version landet im Termin-Verlauf.
pub fn apply_remote(conn: &Connection, account: &str, opts: &Opts, g: &GEvent, rep: &mut GSyncReport) -> R<()> {
    let Some(key) = g.noteforge_id() else { return Ok(()) };
    let updated = plan::parse_updated(&g.updated);
    let link = links(conn, account)?.remove(key);
    if let Some(l) = &link
        && updated <= l.remote_updated
    {
        return Ok(()); // eigenes Echo oder schon verarbeitet
    }
    let gid = link.as_ref().map(|l| l.google_id.clone()).unwrap_or_else(|| g.id.clone());
    let old_hash = link.as_ref().map(|l| l.hash.clone()).unwrap_or_default();
    let event_id = key.strip_prefix("event:");
    let local = match event_id {
        Some(id) => repo::get_event(conn, id)?,
        None => None,
    };
    // Nur eigene Kalendertermine sind in beide Richtungen editierbar; Hausaufgaben, Stundenplan und
    // Moodle-Abgaben kommen aus ihrer Quelle (Google-Änderungen werden bei der nächsten Änderung überschrieben).
    let Some(local) = local.filter(|e| e.source == "manual") else {
        if g.status == "cancelled" {
            save_link(conn, account, key, &gid, &old_hash, updated, true)?;
        } else if let Some(l) = link {
            save_link(conn, account, key, &gid, &l.hash, updated, l.deleted)?;
        }
        return Ok(());
    };
    let subs = subjects(conn)?;
    let subj = subject_info(&subs, local.subject_id.as_deref());
    let local_hash = plan::event_item(&local, subject_info(&subs, local.subject_id.as_deref()), opts).hash();
    let local_changed = link.is_some() && local_hash != old_hash;
    let local_wins = local_changed && local.updated_at > updated;

    if g.status == "cancelled" {
        if local_wins {
            rep.conflicts += 1;
            // Lokal neuer: Termin bleibt und wird beim Push wieder angelegt
            save_link(conn, account, key, &gid, "", updated, false)?;
        } else {
            snapshot(conn, &local.id, &event_json(&local), "local", "In Google gelöscht")?;
            repo::delete_event(conn, &local.id)?;
            save_link(conn, account, key, &gid, &old_hash, updated, true)?;
            rep.pulled += 1;
        }
        return Ok(());
    }

    let Some((start, all_day)) = plan::parse_time(&g.start) else { return Ok(()) };
    let end = plan::parse_time(&g.end).map(|(e, _)| e);
    let title = plan::strip_title(&g.summary, &local.kind, subj.as_ref().map(|s| s.name));
    let end = if all_day { None } else { end.filter(|e| *e > start) };
    let remote = Event { title: if title.is_empty() { local.title.clone() } else { title }, start, end, ..local.clone() };
    let same = remote.title == local.title && remote.start == local.start
        && (remote.end == local.end || (local.end.is_none() && !all_day && end.is_some()));
    if same {
        save_link(conn, account, key, &gid, &old_hash, updated, false)?;
        return Ok(());
    }
    if local_wins {
        rep.conflicts += 1;
        snapshot(conn, &local.id, &event_json(&remote), "google", "Konflikt: lokale Änderung war neuer")?;
        save_link(conn, account, key, &gid, &old_hash, updated, false)?;
        return Ok(());
    }
    if local_changed {
        rep.conflicts += 1;
    }
    snapshot(conn, &local.id, &event_json(&local),
        "local", if local_changed { "Konflikt: Änderung in Google war neuer" } else { "In Google geändert" })?;
    let saved = repo::save_event_at(conn, remote, updated.max(local.updated_at + 1))?;
    let new_hash = plan::event_item(&saved, subject_info(&subs, saved.subject_id.as_deref()), opts).hash();
    save_link(conn, account, key, &gid, &new_hash, updated, false)?;
    rep.pulled += 1;
    Ok(())
}

async fn pull_calendar(db: &Db, api: &Api, account: &str, cal: &str, token: Option<String>, target: Option<&Opts>, rep: &mut GSyncReport) -> R<Option<String>> {
    let time_min = plan::rfc3339(now_ms() - 60 * DAY);
    let page = match api.list(cal, token.as_deref(), &time_min).await? {
        ListResult::Ok(p) => p,
        ListResult::TokenExpired => {
            db.conn().execute("DELETE FROM gcal_remote WHERE account=?1 AND calendar_id=?2", params![account, cal])?;
            match api.list(cal, None, &time_min).await? {
                ListResult::Ok(p) => p,
                ListResult::TokenExpired => return Err(IntErr::Remote("Google: Abruf nicht möglich".into())),
            }
        }
    };
    if token.is_none() {
        db.conn().execute("DELETE FROM gcal_remote WHERE account=?1 AND calendar_id=?2", params![account, cal])?;
    }
    let conn = db.conn();
    for g in &page.items {
        match (target, g.noteforge_id()) {
            (Some(opts), Some(_)) => apply_remote(&conn, account, opts, g, rep)?,
            _ => store_remote(&conn, account, cal, g)?,
        }
    }
    Ok(page.next_sync_token)
}

// ---------- Ablauf ----------

static RUNNING: AtomicBool = AtomicBool::new(false);

type AccountState = (Option<String>, Opts, Option<String>, Vec<(String, Option<String>)>);

async fn sync_account(db: &Db, email: &str, rep: &mut GSyncReport) -> R<()> {
    let (cal, opts, token, sources): AccountState = {
        let c = db.conn();
        let (cal, opts, token) = c.query_row(
            "SELECT calendar_id, opts, sync_token FROM gcal_account WHERE email=?1",
            [email],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)),
        )?;
        let mut st = c.prepare("SELECT calendar_id, sync_token FROM gcal_source WHERE account=?1")?;
        let sources = st.query_map([email], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        (cal, serde_json::from_str(&opts).unwrap_or_default(), token, sources)
    };
    let api = api_for(db, email).await?;

    // 1) Google → Noteforge (Zielkalender: Rückübernahme; Quellkalender: nur anzeigen)
    if let Some(cal) = &cal {
        let next = pull_calendar(db, &api, email, cal, token, Some(&opts), rep).await?;
        db.conn().execute("UPDATE gcal_account SET sync_token=?2 WHERE email=?1", params![email, next])?;
    }
    for (sid, tok) in sources {
        let next = pull_calendar(db, &api, email, &sid, tok, None, rep).await?;
        db.conn().execute("UPDATE gcal_source SET sync_token=?3 WHERE account=?1 AND calendar_id=?2", params![email, sid, next])?;
    }

    // 2) Noteforge → Google (Warteschlange = Abweichung zwischen Soll und zuletzt übertragenem Stand)
    let Some(cal) = cal else { return Ok(()) };
    let ops = plan_account(&db.conn(), email, &opts, now_ms())?;
    rep.pending += ops.len().saturating_sub(MAX_WRITES);
    for op in ops.into_iter().take(MAX_WRITES) {
        match &op {
            Op::Upsert(it) => {
                let gid = links(&db.conn(), email)?.remove(&it.key).map(|l| l.google_id).unwrap_or_else(|| plan::google_id(email, &it.key));
                let mut body = it.body.clone();
                body["status"] = serde_json::json!("confirmed");
                let res = match api.update(&cal, &gid, &body).await? {
                    WriteResult::Gone => {
                        body["id"] = serde_json::json!(gid);
                        match api.insert(&cal, &body).await? {
                            WriteResult::Conflict => api.update(&cal, &gid, &body).await?,
                            r => r,
                        }
                    }
                    r => r,
                };
                match res {
                    WriteResult::Ok(g) => {
                        save_link(&db.conn(), email, &it.key, &g.id, &it.hash(), plan::parse_updated(&g.updated), false)?;
                        rep.pushed += 1;
                    }
                    _ => rep.errors.push(format!("Google: „{}“ konnte nicht gespeichert werden", it.body["summary"].as_str().unwrap_or(op.key()))),
                }
            }
            Op::Delete { key, google_id } => {
                api.delete(&cal, google_id).await?;
                db.conn().execute("DELETE FROM gcal_link WHERE account=?1 AND local_key=?2", params![email, key])?;
                rep.deleted += 1;
            }
        }
    }
    Ok(())
}

/// Alle Konten abgleichen. Fehler werden pro Konto gespeichert (Statusanzeige); offline bleibt die
/// Warteschlange erhalten und wird beim nächsten Durchlauf nachgeholt.
pub async fn sync_all(db: &Db) -> R<GSyncReport> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(GSyncReport { skipped: true, ..Default::default() });
    }
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _g = Guard;
    let emails: Vec<String> = {
        let c = db.conn();
        let mut st = c.prepare("SELECT email FROM gcal_account ORDER BY created_at")?;
        st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    let mut rep = GSyncReport { skipped: emails.is_empty(), ..Default::default() };
    for email in emails {
        let res = sync_account(db, &email, &mut rep).await;
        let err = res.err().map(|e| match e {
            IntErr::Net(_) => "Keine Verbindung – Änderungen werden nachgeholt".to_string(),
            e => e.to_string(),
        });
        if let Some(e) = &err {
            rep.errors.push(format!("{email}: {e}"));
        }
        db.conn().execute(
            "UPDATE gcal_account SET last_error=?2, last_sync=CASE WHEN ?2 IS NULL THEN ?3 ELSE last_sync END WHERE email=?1",
            params![email, err, now_ms()],
        )?;
    }
    Ok(rep)
}

#[tauri::command]
pub async fn gcal_sync(db: S<'_>) -> R<GSyncReport> {
    sync_all(&db).await
}

// ---------- Anzeige im Noteforge-Kalender ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEvent {
    pub account: String,
    pub calendar_id: String,
    pub calendar_name: String,
    pub color: String,
    pub id: String,
    pub title: String,
    pub start: i64,
    pub end: Option<i64>,
    pub all_day: bool,
    pub location: String,
    /// Erkannte Klassenarbeit/Test (nur wenn aktiviert und nicht verworfen).
    pub suggestion: Option<plan::Suggestion>,
}

#[tauri::command]
pub fn gcal_events(db: S, from: i64, to: i64) -> R<Vec<RemoteEvent>> {
    let c = db.conn();
    let subs: Vec<(String, String)> = subjects(&c)?.into_iter().map(|(id, (n, _))| (id, n)).collect();
    let mut st = c.prepare(
        r#"SELECT r.account, r.calendar_id, COALESCE(s.name, a.calendar_name), COALESCE(s.color, '#4285f4'), r.id, r.title,
                  r.start, r."end", r.all_day, r.location, r.dismissed, a.opts
           FROM gcal_remote r JOIN gcal_account a ON a.email = r.account
           LEFT JOIN gcal_source s ON s.account = r.account AND s.calendar_id = r.calendar_id
           WHERE r.start < ?2 AND COALESCE(r."end", r.start) >= ?1 ORDER BY r.start"#,
    )?;
    let rows = st.query_map([from, to], |r| {
        let dismissed: bool = r.get(10)?;
        let opts: Opts = serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default();
        let title: String = r.get(5)?;
        Ok(RemoteEvent {
            account: r.get(0)?, calendar_id: r.get(1)?, calendar_name: r.get(2)?, color: r.get(3)?, id: r.get(4)?,
            suggestion: if dismissed || !opts.detect_exams { None } else { plan::detect_exam(&title, &subs) },
            title, start: r.get(6)?, end: r.get(7)?, all_day: r.get(8)?, location: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Vorschlag übernehmen: legt eine Klassenarbeit/einen Test an. Liegt der Google-Termin im
/// Zielkalender, wird er selbst zum Noteforge-Termin (keine Dublette).
#[tauri::command]
pub fn gcal_adopt(db: S, account: String, calendar_id: String, id: String, kind: String, subject_id: Option<String>) -> R<Event> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let (title, start, end, all_day): (String, i64, Option<i64>, bool) = tx.query_row(
        r#"SELECT title, start, "end", all_day FROM gcal_remote WHERE account=?1 AND calendar_id=?2 AND id=?3"#,
        params![account, calendar_id, id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let ev = repo::save_event(&tx, Event {
        id: String::new(), subject_id, kind, title, start, end: if all_day { None } else { end },
        note: String::new(), source: "manual".into(), remind_before: Some(1440), page_id: None, updated_at: 0,
    })?;
    let target: Option<String> = tx.query_row("SELECT calendar_id FROM gcal_account WHERE email=?1", [&account], |r| r.get(0))?;
    if target.as_deref() == Some(calendar_id.as_str()) {
        save_link(&tx, &account, &format!("event:{}", ev.id), &id, "", 0, false)?;
        tx.execute("DELETE FROM gcal_remote WHERE account=?1 AND calendar_id=?2 AND id=?3", params![account, calendar_id, id])?;
    } else {
        tx.execute("UPDATE gcal_remote SET dismissed=1 WHERE account=?1 AND calendar_id=?2 AND id=?3", params![account, calendar_id, id])?;
    }
    tx.commit()?;
    Ok(ev)
}

#[tauri::command]
pub fn gcal_dismiss(db: S, account: String, calendar_id: String, id: String) -> R<()> {
    db.conn().execute("UPDATE gcal_remote SET dismissed=1 WHERE account=?1 AND calendar_id=?2 AND id=?3", params![account, calendar_id, id])?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub event: serde_json::Value,
    pub origin: String,
    pub reason: String,
    pub at: i64,
}

#[tauri::command]
pub fn event_history(db: S, event_id: String) -> R<Vec<HistoryEntry>> {
    let c = db.conn();
    let mut st = c.prepare("SELECT id, snapshot, origin, reason, at FROM event_history WHERE event_id=?1 ORDER BY at DESC LIMIT 20")?;
    let rows = st.query_map([&event_id], |r| {
        let s: String = r.get(1)?;
        Ok(HistoryEntry { id: r.get(0)?, event: serde_json::from_str(&s).unwrap_or_default(), origin: r.get(2)?, reason: r.get(3)?, at: r.get(4)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Version aus dem Verlauf wiederherstellen (zählt als neue lokale Änderung).
#[tauri::command]
pub fn event_history_restore(db: S, entry_id: i64) -> R<Event> {
    let c = db.conn();
    let (eid, s): (String, String) = c.query_row("SELECT event_id, snapshot FROM event_history WHERE id=?1", [entry_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut e: Event = serde_json::from_str(&s).map_err(|e| IntErr::Other(e.to_string()))?;
    e.id = eid;
    if let Some(cur) = repo::get_event(&c, &e.id)? {
        snapshot(&c, &cur.id, &event_json(&cur), "local", "Vor Wiederherstellung")?;
    }
    Ok(repo::save_event(&c, e)?)
}

#[cfg(test)]
mod tests;
