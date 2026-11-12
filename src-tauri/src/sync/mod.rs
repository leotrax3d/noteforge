//! Phase 8 (SPEC §9): Nextcloud-Sync über WebDAV + tägliches lokales Backup.
//!
//! Ablage auf dem Server (`<Ordner>/`):
//!   struct.json.gz        Fächer, Themen, Tags, Vorlagen, eigene Termine
//!   pages/<id>.json.gz    je Blatt: Zeile, Elemente (inkl. Bilder/PDF-Seiten), Tags
//!
//! Änderungserkennung ist **uhrunabhängig**: lokal über einen Fingerabdruck je Blatt,
//! auf dem Server über ETags. Nur wenn beide Seiten ein Blatt geändert haben, zählt die Zeit
//! („neuere Version gewinnt“). Dafür wird jede Bearbeitungszeit in **Serverzeit** umgerechnet:
//! Der Abstand der lokalen Uhr zur Nextcloud-Uhr wird bei jedem Sync aus dem `Date`-Header
//! gemessen. So entscheidet eine falsch gehende Windows-Uhr keinen Konflikt falsch.
//! Die unterlegene Version bleibt als Seitenversion erhalten.

pub mod backup;
pub mod dav;
pub mod doc;

use crate::db::{onenote, repo::now_ms, Db};
use crate::integrations::secrets;
use doc::{PageDoc, StructDoc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, thiserror::Error)]
pub enum SyncErr {
    #[error("{0}")]
    Config(String),
    #[error("{0}")]
    Auth(String),
    #[error("{0}")]
    Remote(String),
    #[error("Keine Verbindung zur Nextcloud: {0}")]
    Net(#[from] reqwest::Error),
    #[error(transparent)]
    Db(#[from] crate::db::Error),
    #[error("Datenbankfehler: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

impl serde::Serialize for SyncErr {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type R<T> = Result<T, SyncErr>;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub etag: String,
    pub modified: Option<i64>,
}

/// Speicher-Gegenstelle (WebDAV; in Tests ein Speicher im Prozess).
#[allow(async_fn_in_trait)]
pub trait Remote {
    /// Serverzeit − lokale Zeit in ms (sofern gemessen).
    fn clock_offset(&self) -> Option<i64>;
    /// Aktuelle Serverzeit (ms).
    fn server_now(&self) -> i64 {
        now_ms() + self.clock_offset().unwrap_or(0)
    }
    async fn ensure_dirs(&self, dirs: &[&str]) -> R<()>;
    async fn list(&self, dir: &str) -> R<HashMap<String, Entry>>;
    async fn get(&self, path: &str) -> R<Option<(Vec<u8>, String)>>;
    /// `if_match = None` → nur anlegen, wenn die Datei fehlt. `Ok(None)` = Vorbedingung verletzt.
    async fn put(&self, path: &str, bytes: Vec<u8>, if_match: Option<&str>) -> R<Option<String>>;
    async fn delete(&self, path: &str, if_match: &str) -> R<bool>;
}

const STRUCT_FILE: &str = "struct.json.gz";
const PAGES: &str = "pages";
const SUFFIX: &str = ".json.gz";
/// Ab dieser Abweichung wird auf die Uhr hingewiesen (ausgeglichen wird immer).
pub const CLOCK_WARN_MS: i64 = 2 * 60_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub conflicts: usize,
    pub structure_changed: bool,
    /// Lokal geänderte Blätter (Frontend lädt diese neu).
    pub changed_pages: Vec<String>,
    pub errors: Vec<String>,
    pub clock_offset_ms: Option<i64>,
    pub finished_at: i64,
}

// ---------- Sync-Zustand ----------

/// Uhrumrechnung lokal → Server für einen Lauf.
#[derive(Debug, Clone, Copy)]
struct Clock {
    off: i64,
    server_now: i64,
}

#[derive(Debug, Clone)]
struct PageState {
    etag: String,
    fp: String,
    edited: i64,
}

fn states(conn: &Connection) -> R<HashMap<String, PageState>> {
    let mut st = conn.prepare("SELECT page_id, etag, fp, edited FROM sync_page")?;
    let it = st.query_map([], |r| Ok((r.get::<_, String>(0)?, PageState { etag: r.get(1)?, fp: r.get(2)?, edited: r.get(3)? })))?;
    Ok(it.collect::<rusqlite::Result<_>>()?)
}

fn set_state(conn: &Connection, id: &str, s: &PageState) -> R<()> {
    conn.execute(
        "INSERT INTO sync_page (page_id, etag, fp, edited) VALUES (?1,?2,?3,?4)
         ON CONFLICT(page_id) DO UPDATE SET etag=excluded.etag, fp=excluded.fp, edited=excluded.edited",
        params![id, s.etag, s.fp, s.edited],
    )?;
    Ok(())
}

fn drop_state(conn: &Connection, id: &str) -> R<()> {
    conn.execute("DELETE FROM sync_page WHERE page_id=?1", [id])?;
    Ok(())
}

fn meta(conn: &Connection, key: &str) -> R<Option<Vec<u8>>> {
    Ok(conn.query_row("SELECT value FROM sync_meta WHERE key=?1", [key], |r| r.get(0)).optional()?)
}

fn set_meta(conn: &Connection, key: &str, v: &[u8]) -> R<()> {
    conn.execute(
        "INSERT INTO sync_meta (key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, v],
    )?;
    Ok(())
}

/// Vergisst den Sync-Zustand (anderer Server/Ordner): nächster Lauf gleicht alles neu ab.
pub fn reset_state(conn: &Connection) -> R<()> {
    conn.execute_batch("DELETE FROM sync_page; DELETE FROM sync_meta;")?;
    Ok(())
}

fn page_path(id: &str) -> String {
    format!("{PAGES}/{id}{SUFFIX}")
}

fn updated_at(conn: &Connection, id: &str) -> R<i64> {
    Ok(conn.query_row("SELECT updated_at FROM page WHERE id=?1", [id], |r| r.get(0))?)
}

fn label_time(server_ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(server_ms).single().map(|t| t.format("%d.%m.%Y %H:%M").to_string()).unwrap_or_default()
}

// ---------- Ablauf ----------

enum Action {
    Upload(Option<String>),
    Download,
    Conflict,
    PurgeLocal,
    DeleteRemote(String),
    Forget,
}

fn decide(local: Option<&str>, state: Option<&PageState>, remote: Option<&Entry>) -> Option<Action> {
    let lchg = |s: &PageState| local.is_some_and(|fp| fp != s.fp);
    let rchg = |s: &PageState| remote.is_some_and(|e| e.etag != s.etag);
    Some(match (local, state, remote) {
        (Some(_), None, None) => Action::Upload(None),
        (Some(_), None, Some(_)) => Action::Conflict,
        (None, None, Some(_)) => Action::Download,
        (None, None, None) => return None,
        (Some(_), Some(s), Some(e)) => match (lchg(s), rchg(s)) {
            (false, false) => return None,
            (true, false) => Action::Upload(Some(e.etag.clone())),
            (false, true) => Action::Download,
            (true, true) => Action::Conflict,
        },
        // Auf dem Server endgültig gelöscht
        (Some(_), Some(s), None) => if lchg(s) { Action::Upload(None) } else { Action::PurgeLocal },
        // Lokal endgültig gelöscht
        (None, Some(s), Some(e)) => if rchg(s) { Action::Download } else { Action::DeleteRemote(e.etag.clone()) },
        (None, Some(_), None) => Action::Forget,
    })
}

pub async fn run<Rm: Remote>(db: &Db, rm: &Rm, device: &str) -> R<Report> {
    let mut rep = Report::default();
    rm.ensure_dirs(&[PAGES]).await?;
    let root = rm.list("").await?;
    let remote_pages: HashMap<String, Entry> = rm
        .list(PAGES)
        .await?
        .into_iter()
        .filter_map(|(n, e)| n.strip_suffix(SUFFIX).map(|id| (id.to_string(), e)))
        .collect();
    let clk = Clock { off: rm.clock_offset().unwrap_or(0), server_now: rm.server_now() };
    rep.clock_offset_ms = rm.clock_offset();

    sync_struct(db, rm, device, root.get(STRUCT_FILE), &mut rep).await?;
    sync_pages(db, rm, device, clk, &remote_pages, &mut rep).await?;
    rep.finished_at = now_ms();
    Ok(rep)
}

async fn sync_struct<Rm: Remote>(db: &Db, rm: &Rm, device: &str, remote: Option<&Entry>, rep: &mut Report) -> R<()> {
    let (local, base, base_etag) = {
        let c = db.conn();
        let base: Option<StructDoc> = meta(&c, "struct_base")?.and_then(|b| doc::unpack(&b).ok());
        let etag = meta(&c, "struct_etag")?.map(|b| String::from_utf8_lossy(&b).into_owned());
        (doc::dump_struct(&c, device)?, base, etag)
    };
    let (remote_doc, remote_etag) = match remote {
        None => (None, None),
        Some(e) if Some(&e.etag) == base_etag.as_ref() && base.is_some() => (base.clone(), Some(e.etag.clone())),
        Some(_) => match rm.get(STRUCT_FILE).await? {
            Some((b, etag)) => (Some(doc::unpack::<StructDoc>(&b)?), Some(etag)),
            None => (None, None),
        },
    };
    let empty = doc::Tables::new();
    let merged = doc::merge(
        base.as_ref().map(|b| &b.tables).unwrap_or(&empty),
        &local.tables,
        remote_doc.as_ref().map(|r| &r.tables).unwrap_or(&empty),
    );
    {
        let mut c = db.conn();
        let tx = c.transaction()?;
        // Zwischenzeitliche lokale Änderungen berücksichtigen
        let now = doc::dump_struct(&tx, device)?;
        let merged_now = doc::merge(&local.tables, &now.tables, &merged);
        if doc::apply_struct(&tx, &now.tables, &merged_now)? {
            rep.structure_changed = true;
        }
        tx.commit()?;
    }
    let mut new_etag = remote_etag.clone();
    if remote_doc.as_ref().map(|r| &r.tables) != Some(&merged) {
        let out = StructDoc { v: doc::FORMAT, device: device.into(), tables: merged.clone() };
        // Nicht gelesene Version nie überschreiben: If-Match auf den gelesenen ETag
        let if_match = if remote_doc.is_some() { remote_etag.as_deref() } else { None };
        match rm.put(STRUCT_FILE, doc::pack(&out)?, if_match).await? {
            Some(e) => new_etag = Some(e),
            None => {
                rep.errors.push("Struktur wurde gleichzeitig auf einem anderen Gerät geändert – nächster Sync gleicht ab".into());
                return Ok(());
            }
        }
    }
    let c = db.conn();
    set_meta(&c, "struct_base", &doc::pack(&StructDoc { v: doc::FORMAT, device: device.into(), tables: merged })?)?;
    if let Some(e) = new_etag {
        set_meta(&c, "struct_etag", e.as_bytes())?;
    }
    Ok(())
}

async fn sync_pages<Rm: Remote>(db: &Db, rm: &Rm, device: &str, clk: Clock, remote: &HashMap<String, Entry>, rep: &mut Report) -> R<()> {
    let (local, st): (HashMap<String, String>, HashMap<String, PageState>) = {
        let c = db.conn();
        let ids: Vec<String> = {
            let mut s = c.prepare("SELECT id FROM page")?;
            let it = s.query_map([], |r| r.get(0))?;
            it.collect::<rusqlite::Result<_>>()?
        };
        let mut local = HashMap::new();
        for id in ids {
            if let Some(fp) = doc::fingerprint(&c, &id)? {
                local.insert(id, fp);
            }
        }
        (local, states(&c)?)
    };
    let ids: BTreeSet<&String> = local.keys().chain(st.keys()).chain(remote.keys()).collect();
    // Downloads, deren Eltern (Thema/Oberseite) noch fehlen, werden am Ende erneut versucht.
    let mut retry: Vec<(PageDoc, String)> = Vec::new();
    for id in ids {
        let (l, s, r) = (local.get(id), st.get(id), remote.get(id));
        let Some(action) = decide(l.map(String::as_str), s, r) else { continue };
        let res = match action {
            Action::Upload(if_match) => upload(db, rm, device, clk, id, s, if_match.as_deref(), rep).await,
            Action::Download => match fetch(rm, id).await? {
                Some((d, etag)) => match apply_remote(db, id, l.map(String::as_str), &d, &etag, None) {
                    Ok(true) => {
                        rep.downloaded += 1;
                        rep.changed_pages.push(id.clone());
                        Ok(())
                    }
                    Ok(false) => Ok(()),
                    Err(_) => {
                        retry.push((d, etag));
                        Ok(())
                    }
                },
                None => Ok(()),
            },
            Action::Conflict => conflict(db, rm, device, clk, id, rep).await,
            Action::PurgeLocal => {
                let mut c = db.conn();
                let tx = c.transaction()?;
                if doc::fingerprint(&tx, id)?.as_deref() == l.map(String::as_str) {
                    onenote::hard_delete(&tx, id)?;
                    drop_state(&tx, id)?;
                    rep.deleted += 1;
                    rep.changed_pages.push(id.clone());
                }
                tx.commit()?;
                Ok(())
            }
            Action::DeleteRemote(etag) => {
                if rm.delete(&page_path(id), &etag).await? {
                    drop_state(&db.conn(), id)?;
                    rep.deleted += 1;
                }
                Ok(())
            }
            Action::Forget => drop_state(&db.conn(), id),
        };
        if let Err(e) = res {
            if matches!(e, SyncErr::Net(_) | SyncErr::Auth(_)) {
                return Err(e);
            }
            rep.errors.push(format!("Blatt {id}: {e}"));
        }
    }
    for _ in 0..3 {
        if retry.is_empty() {
            break;
        }
        let before = retry.len();
        let mut left = Vec::new();
        for (d, etag) in retry {
            let id = doc::page_id(&d);
            let fp = db.conn().query_row("SELECT 1 FROM page WHERE id=?1", [&id], |_| Ok(())).optional()?;
            let cur = if fp.is_some() { doc::fingerprint(&db.conn(), &id)? } else { None };
            match apply_remote(db, &id, cur.as_deref(), &d, &etag, None) {
                Ok(applied) => {
                    if applied {
                        rep.downloaded += 1;
                        rep.changed_pages.push(id);
                    }
                }
                Err(_) => left.push((d, etag)),
            }
        }
        retry = left;
        if retry.len() == before {
            break;
        }
    }
    for (d, _) in retry {
        rep.errors.push(format!("Blatt „{}“: Thema fehlt auf diesem Gerät", d.page.get("title").and_then(|v| v.as_str()).unwrap_or("?")));
    }
    Ok(())
}

async fn fetch<Rm: Remote>(rm: &Rm, id: &str) -> R<Option<(PageDoc, String)>> {
    match rm.get(&page_path(id)).await? {
        Some((b, etag)) => {
            let d: PageDoc = doc::unpack(&b)?;
            if doc::page_id(&d) != id {
                return Err(SyncErr::Remote(format!("Sync-Datei {id} gehört zu einem anderen Blatt")));
            }
            Ok(Some((d, etag)))
        }
        None => Ok(None),
    }
}

/// Lokale Bearbeitungszeit in Serverzeit. Unverändert seit dem letzten Sync → gespeicherter Wert.
fn local_edited(c: &Connection, id: &str, s: Option<&PageState>, fp: &str, clk: Clock) -> R<i64> {
    if let Some(s) = s.filter(|s| s.fp == fp) {
        return Ok(s.edited);
    }
    // Eine Bearbeitung kann nicht nach „jetzt“ liegen: schützt vor einer Uhr, die beim Bearbeiten
    // vorging und inzwischen korrigiert wurde (sonst gewänne dieses Gerät jeden Konflikt).
    Ok((updated_at(c, id)? + clk.off).min(clk.server_now))
}

#[allow(clippy::too_many_arguments)]
async fn upload<Rm: Remote>(db: &Db, rm: &Rm, device: &str, clk: Clock, id: &str, s: Option<&PageState>, if_match: Option<&str>, rep: &mut Report) -> R<()> {
    let (bytes, fp, edited) = {
        let c = db.conn();
        let Some(fp) = doc::fingerprint(&c, id)? else { return Ok(()) };
        let edited = local_edited(&c, id, s, &fp, clk)?;
        let Some(d) = doc::page_doc(&c, id, device, edited)? else { return Ok(()) };
        (doc::pack(&d)?, fp, edited)
    };
    match rm.put(&page_path(id), bytes, if_match).await? {
        Some(etag) => {
            set_state(&db.conn(), id, &PageState { etag, fp, edited })?;
            rep.uploaded += 1;
        }
        None => rep.errors.push(format!("Blatt {id} wurde gleichzeitig geändert – nächster Sync gleicht ab")),
    }
    Ok(())
}

/// Übernimmt den Server-Stand. `expect_fp`: Fingerabdruck, auf dem die Entscheidung beruhte –
/// hat sich das Blatt inzwischen lokal geändert, wird nichts überschrieben.
fn apply_remote(db: &Db, id: &str, expect_fp: Option<&str>, d: &PageDoc, etag: &str, version_label: Option<&str>) -> R<bool> {
    let mut c = db.conn();
    let tx = c.transaction()?;
    let now_fp = doc::fingerprint(&tx, id)?;
    if now_fp.as_deref() != expect_fp {
        return Ok(false);
    }
    if let (Some(label), Some(_)) = (version_label, &now_fp) {
        onenote::create_version(&tx, id, label)?;
    }
    doc::apply_page(&tx, d)?;
    let fp = doc::fingerprint(&tx, id)?.unwrap_or_default();
    set_state(&tx, id, &PageState { etag: etag.into(), fp, edited: d.edited })?;
    tx.commit()?;
    Ok(true)
}

async fn conflict<Rm: Remote>(db: &Db, rm: &Rm, device: &str, clk: Clock, id: &str, rep: &mut Report) -> R<()> {
    let Some((remote, etag)) = fetch(rm, id).await? else { return Ok(()) };
    let (fp, local_doc, local_t) = {
        let c = db.conn();
        let Some(fp) = doc::fingerprint(&c, id)? else { return Ok(()) };
        let st = states(&c)?;
        let t = local_edited(&c, id, st.get(id), &fp, clk)?;
        (fp.clone(), doc::page_doc(&c, id, device, t)?, t)
    };
    let Some(local_doc) = local_doc else { return Ok(()) };
    // Inhaltlich gleich (z. B. erster Sync zweier Geräte mit demselben Stand)
    if local_doc.page == remote.page && local_doc.elements == remote.elements && local_doc.tags == remote.tags {
        set_state(&db.conn(), id, &PageState { etag, fp, edited: remote.edited.max(local_t) })?;
        return Ok(());
    }
    rep.conflicts += 1;
    if remote.edited >= local_t {
        // Server ist neuer: lokalen Stand als Version sichern, Server übernehmen.
        let label = format!("Sync-Konflikt: Stand dieses Geräts ({})", label_time(local_t));
        if apply_remote(db, id, Some(&fp), &remote, &etag, Some(&label))? {
            rep.downloaded += 1;
            rep.changed_pages.push(id.into());
        }
        return Ok(());
    }
    // Lokal ist neuer: Server-Stand als Version sichern, dann hochladen.
    {
        let mut c = db.conn();
        let tx = c.transaction()?;
        if doc::fingerprint(&tx, id)?.as_deref() != Some(&fp) {
            return Ok(());
        }
        doc::apply_page(&tx, &remote)?;
        let label = format!("Sync-Konflikt: Stand von {} ({})", remote.device, label_time(remote.edited));
        onenote::create_version(&tx, id, &label)?;
        doc::apply_page(&tx, &local_doc)?;
        tx.commit()?;
    }
    let fp_after = doc::fingerprint(&db.conn(), id)?.unwrap_or_default();
    let s = PageState { etag: etag.clone(), fp: fp_after, edited: local_t };
    upload(db, rm, device, clk, id, Some(&s), Some(&etag), rep).await?;
    rep.changed_pages.push(id.into());
    Ok(())
}

// ---------- Konfiguration + Tauri-Commands ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub server: String,
    pub username: String,
    pub folder: String,
    /// Minuten zwischen automatischen Läufen (0 = nur manuell).
    pub interval_min: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub config: Option<SyncConfig>,
    pub running: bool,
    pub last: Option<Report>,
    pub last_error: Option<String>,
    pub device: String,
    pub backups: Vec<backup::BackupInfo>,
    pub backup_dir: String,
    /// Ab dieser Uhr-Abweichung zeigt die UI einen Hinweis.
    pub clock_warn_ms: i64,
}

const CONFIG_KEY: &str = "sync.config";
const LAST_KEY: &str = "sync.last";
const ERROR_KEY: &str = "sync.error";
const SECRET: &str = "nextcloud";
static RUNNING: AtomicBool = AtomicBool::new(false);

pub fn device_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Gerät".into())
}

fn setting<T: serde::de::DeserializeOwned>(c: &Connection, key: &str) -> R<Option<T>> {
    let v: Option<String> = c.query_row("SELECT value FROM setting WHERE key=?1", [key], |r| r.get(0)).optional()?;
    Ok(v.and_then(|s| serde_json::from_str(&s).ok()))
}

fn set_setting<T: Serialize>(c: &Connection, key: &str, v: Option<&T>) -> R<()> {
    match v {
        Some(v) => {
            let json = serde_json::to_string(v).map_err(crate::db::Error::from)?;
            c.execute(
                "INSERT INTO setting (key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, json],
            )?;
        }
        None => {
            c.execute("DELETE FROM setting WHERE key=?1", [key])?;
        }
    }
    Ok(())
}

fn client(cfg: &SyncConfig, password: &str) -> R<dav::Dav> {
    dav::Dav::new(dav::dav_base(&cfg.server, &cfg.username, &cfg.folder)?, cfg.username.trim().into(), password.into())
}

struct Running;
impl Running {
    fn start() -> Option<Self> {
        RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).ok().map(|_| Running)
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Ein Sync-Lauf mit gespeicherter Konfiguration; Ergebnis/Fehler werden gespeichert.
pub async fn sync_once(db: &Db) -> R<Option<Report>> {
    let Some(cfg) = setting::<SyncConfig>(&db.conn(), CONFIG_KEY)? else { return Ok(None) };
    let Some(_guard) = Running::start() else { return Ok(None) };
    let pass = secrets::get(SECRET).map_err(SyncErr::Config)?.ok_or_else(|| SyncErr::Auth("Nextcloud-Passwort fehlt – bitte neu verbinden".into()))?;
    let res = run(db, &client(&cfg, &pass)?, &device_name()).await;
    let c = db.conn();
    match &res {
        Ok(r) => {
            set_setting(&c, LAST_KEY, Some(r))?;
            set_setting::<String>(&c, ERROR_KEY, None)?;
        }
        Err(e) => set_setting(&c, ERROR_KEY, Some(&e.to_string()))?,
    }
    res.map(Some)
}

fn status(app: &AppHandle, db: &Db) -> R<SyncStatus> {
    let c = db.conn();
    let dir = backup::dir(app, &c);
    Ok(SyncStatus {
        config: setting(&c, CONFIG_KEY)?,
        running: RUNNING.load(Ordering::SeqCst),
        last: setting(&c, LAST_KEY)?,
        last_error: setting(&c, ERROR_KEY)?,
        device: device_name(),
        backups: dir.as_deref().map(backup::list).unwrap_or_default(),
        backup_dir: dir.map(|d| d.display().to_string()).unwrap_or_default(),
        clock_warn_ms: CLOCK_WARN_MS,
    })
}

type S<'a> = State<'a, Db>;

#[tauri::command]
pub fn sync_status(app: AppHandle, db: S<'_>) -> R<SyncStatus> {
    status(&app, &db)
}

#[tauri::command]
pub async fn sync_connect(app: AppHandle, db: S<'_>, server: String, username: String, password: String, folder: String, interval_min: i64) -> R<SyncStatus> {
    let cfg = SyncConfig { server: server.trim().into(), username: username.trim().into(), folder: folder.trim().into(), interval_min: interval_min.clamp(0, 1440) };
    if cfg.username.is_empty() {
        return Err(SyncErr::Config("Benutzername fehlt".into()));
    }
    let password = if password.is_empty() {
        secrets::get(SECRET).map_err(SyncErr::Config)?.ok_or_else(|| SyncErr::Config("App-Passwort fehlt".into()))?
    } else {
        password
    };
    // Verbindung prüfen, bevor etwas gespeichert wird
    let c = client(&cfg, &password)?;
    c.ensure_dirs(&[PAGES]).await?;
    secrets::set(SECRET, &password).map_err(SyncErr::Config)?;
    {
        let conn = db.conn();
        let old: Option<SyncConfig> = setting(&conn, CONFIG_KEY)?;
        let same_target = old.as_ref().is_some_and(|o| o.server == cfg.server && o.username == cfg.username && o.folder == cfg.folder);
        if !same_target {
            reset_state(&conn)?;
            set_setting::<Report>(&conn, LAST_KEY, None)?;
        }
        set_setting(&conn, CONFIG_KEY, Some(&cfg))?;
        set_setting::<String>(&conn, ERROR_KEY, None)?;
    }
    status(&app, &db)
}

#[tauri::command]
pub fn sync_disconnect(app: AppHandle, db: S<'_>) -> R<SyncStatus> {
    {
        let c = db.conn();
        for k in [CONFIG_KEY, LAST_KEY, ERROR_KEY] {
            set_setting::<()>(&c, k, None)?;
        }
        reset_state(&c)?;
    }
    secrets::delete(SECRET).map_err(SyncErr::Config)?;
    status(&app, &db)
}

#[tauri::command]
pub async fn sync_now(app: AppHandle, db: S<'_>) -> R<Option<Report>> {
    let r = sync_once(&db).await?;
    if let Some(r) = &r {
        let _ = app.emit("sync-finished", r);
    }
    Ok(r)
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: S<'_>) -> R<SyncStatus> {
    let dir = backup::dir(&app, &db.conn()).ok_or_else(|| SyncErr::Config("Kein Datenordner".into()))?;
    backup::create(&db, &dir, true)?;
    status(&app, &db)
}

/// Hintergrund: Backup einmal täglich, Sync im eingestellten Abstand.
pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("sync".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_secs(8));
            let mut last_sync = 0i64;
            loop {
                let db = app.state::<Db>();
                let bdir = backup::dir(&app, &db.conn());
                if let Some(dir) = bdir
                    && let Err(e) = backup::create(&db, &dir, false) {
                        eprintln!("Backup fehlgeschlagen: {e}");
                    }
                let interval = setting::<SyncConfig>(&db.conn(), CONFIG_KEY).ok().flatten().map(|c| c.interval_min).unwrap_or(0);
                if interval > 0 && now_ms() - last_sync >= interval * 60_000 {
                    last_sync = now_ms();
                    match tauri::async_runtime::block_on(sync_once(&db)) {
                        Ok(Some(r)) => {
                            let _ = app.emit("sync-finished", &r);
                        }
                        Ok(None) => {}
                        Err(e) => {
                            let _ = app.emit("sync-failed", e.to_string());
                        }
                    }
                }
                std::thread::sleep(Duration::from_secs(30));
            }
        })
        .expect("Sync-Thread");
}

#[cfg(test)]
mod tests;
