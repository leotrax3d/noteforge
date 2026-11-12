//! Zwei „Geräte“ (eigene Datenbanken) gegen einen Server im Speicher.

use super::*;
use crate::db::{models::{BBox, Element}, repo};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Server {
    files: HashMap<String, (Vec<u8>, String)>,
    n: u64,
}

struct Fake {
    srv: Arc<Mutex<Server>>,
    /// Serverzeit − Gerätezeit
    offset: i64,
}

impl Remote for Fake {
    fn clock_offset(&self) -> Option<i64> {
        Some(self.offset)
    }
    /// Die Server-Uhr ist die echte Uhr; ein Gerät mit `offset = -3 h` geht also 3 h vor.
    fn server_now(&self) -> i64 {
        now_ms()
    }
    async fn ensure_dirs(&self, _: &[&str]) -> R<()> {
        Ok(())
    }
    async fn list(&self, dir: &str) -> R<HashMap<String, Entry>> {
        let s = self.srv.lock().unwrap();
        let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
        Ok(s.files
            .iter()
            .filter_map(|(p, (_, e))| p.strip_prefix(&prefix).filter(|n| !n.contains('/')).map(|n| (n.to_string(), Entry { etag: e.clone(), modified: None })))
            .collect())
    }
    async fn get(&self, path: &str) -> R<Option<(Vec<u8>, String)>> {
        Ok(self.srv.lock().unwrap().files.get(path).cloned())
    }
    async fn put(&self, path: &str, bytes: Vec<u8>, if_match: Option<&str>) -> R<Option<String>> {
        let mut s = self.srv.lock().unwrap();
        let cur = s.files.get(path).map(|f| f.1.clone());
        if cur.as_deref() != if_match {
            return Ok(None);
        }
        s.n += 1;
        let etag = format!("e{}", s.n);
        s.files.insert(path.into(), (bytes, etag.clone()));
        Ok(Some(etag))
    }
    async fn delete(&self, path: &str, if_match: &str) -> R<bool> {
        let mut s = self.srv.lock().unwrap();
        match s.files.get(path) {
            Some((_, e)) if e != if_match => Ok(false),
            _ => {
                s.files.remove(path);
                Ok(true)
            }
        }
    }
}

fn sync(db: &Db, rm: &Fake, dev: &str) -> Report {
    tauri::async_runtime::block_on(run(db, rm, dev)).unwrap()
}

fn text(page: &str, id: &str, s: &str) -> Element {
    Element {
        id: id.into(),
        page_id: page.into(),
        kind: "text".into(),
        z: 0,
        bbox: BBox { x: 0.0, y: 0.0, w: 10.0, h: 10.0 },
        data: serde_json::to_vec(&serde_json::json!({ "html": s })).unwrap(),
    }
}

fn content(db: &Db, page: &str) -> Vec<String> {
    repo::list_elements(&db.conn(), page).unwrap().iter().map(|e| String::from_utf8_lossy(&e.data).into_owned()).collect()
}

fn setup() -> (Db, Db, Fake, Fake, String) {
    let srv = Arc::new(Mutex::new(Server::default()));
    let (a, b) = (Db::open_in_memory().unwrap(), Db::open_in_memory().unwrap());
    let page = {
        let c = a.conn();
        let s = repo::create_subject(&c, "Mathe", "#2563eb", "calculator").unwrap();
        let sec = repo::create_section(&c, &s.id, "Analysis", "#000").unwrap();
        repo::create_page(&c, &sec.id, None, "Ableitungen").unwrap().id
    };
    repo::save_elements(&mut a.conn(), &page, &[text(&page, "t1", "f'(x)")], &[]).unwrap();
    // Gerät B: Uhr geht 3 Stunden vor
    let (ra, rb) = (Fake { srv: srv.clone(), offset: 0 }, Fake { srv, offset: -3 * 3_600_000 });
    (a, b, ra, rb, page)
}

#[test]
fn erster_abgleich_und_ruhe() {
    let (a, b, ra, rb, page) = setup();
    let r = sync(&a, &ra, "A");
    assert_eq!(r.uploaded, 1);
    let r = sync(&b, &rb, "B");
    assert_eq!(r.downloaded, 1);
    assert!(r.structure_changed);
    assert_eq!(content(&b, &page), content(&a, &page));
    assert_eq!(repo::list_subjects(&b.conn()).unwrap()[0].name, "Mathe");
    // Ohne Änderungen passiert nichts
    for (db, rm, d) in [(&a, &ra, "A"), (&b, &rb, "B")] {
        let r = sync(db, rm, d);
        assert_eq!((r.uploaded, r.downloaded, r.conflicts, r.deleted), (0, 0, 0, 0), "{d}: {r:?}");
    }
}

#[test]
fn einseitige_aenderung_wird_uebernommen() {
    let (a, b, ra, rb, page) = setup();
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    repo::save_elements(&mut b.conn(), &page, &[text(&page, "t2", "g(x)")], &[]).unwrap();
    assert_eq!(sync(&b, &rb, "B").uploaded, 1);
    let r = sync(&a, &ra, "A");
    assert_eq!(r.downloaded, 1);
    assert_eq!(r.changed_pages, vec![page.clone()]);
    assert_eq!(content(&a, &page).len(), 2);
    assert_eq!(r.conflicts, 0);
}

/// Kern der Zeitsynchronisation: B's Uhr geht 3 h vor. Ohne Umrechnung in Serverzeit
/// würde B's ältere Änderung gewinnen.
#[test]
fn konflikt_neuere_version_gewinnt_trotz_falscher_uhr() {
    let (a, b, ra, rb, page) = setup();
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    let base = now_ms() - 60_000;
    repo::save_elements(&mut b.conn(), &page, &[text(&page, "t1", "B-alt")], &[]).unwrap();
    // B bearbeitet zuerst (real base), seine Uhr zeigt aber base + 3 h
    b.conn().execute("UPDATE page SET updated_at=?1 WHERE id=?2", params![base + 3 * 3_600_000, page]).unwrap();
    repo::save_elements(&mut a.conn(), &page, &[text(&page, "t1", "A-neu")], &[]).unwrap();
    a.conn().execute("UPDATE page SET updated_at=?1 WHERE id=?2", params![base + 30_000, page]).unwrap();

    assert_eq!(sync(&b, &rb, "B").uploaded, 1);
    let r = sync(&a, &ra, "A");
    assert_eq!(r.conflicts, 1, "{r:?}");
    assert!(content(&a, &page)[0].contains("A-neu"), "A ist neuer und gewinnt");
    let versions = onenote::list_versions(&a.conn(), &page).unwrap();
    assert!(versions.iter().any(|v| v.label.starts_with("Sync-Konflikt: Stand von B")), "B-Stand bleibt als Version");
    // B übernimmt den Gewinner ohne weiteren Konflikt
    let r = sync(&b, &rb, "B");
    assert_eq!((r.downloaded, r.conflicts), (1, 0), "{r:?}");
    assert!(content(&b, &page)[0].contains("A-neu"));
}

#[test]
fn konflikt_server_neuer() {
    let (a, b, ra, rb, page) = setup();
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    let base = now_ms() - 60_000;
    repo::save_elements(&mut a.conn(), &page, &[text(&page, "t1", "A-alt")], &[]).unwrap();
    a.conn().execute("UPDATE page SET updated_at=?1 WHERE id=?2", params![base, page]).unwrap();
    repo::save_elements(&mut b.conn(), &page, &[text(&page, "t1", "B-neu")], &[]).unwrap();
    b.conn().execute("UPDATE page SET updated_at=?1 WHERE id=?2", params![base + 3 * 3_600_000 + 30_000, page]).unwrap();
    sync(&b, &rb, "B");
    let r = sync(&a, &ra, "A");
    assert_eq!(r.conflicts, 1);
    assert!(content(&a, &page)[0].contains("B-neu"));
    let versions = onenote::list_versions(&a.conn(), &page).unwrap();
    assert!(versions.iter().any(|v| v.label.starts_with("Sync-Konflikt: Stand dieses Geräts")));
    let r = sync(&a, &ra, "A");
    assert_eq!(r.uploaded, 0, "nach Übernahme stabil: {r:?}");
}

#[test]
fn loeschen_und_struktur() {
    let (a, b, ra, rb, page) = setup();
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    // A: Fach umbenennen; B: neue Themengruppe + Blatt endgültig löschen
    let subj = repo::list_subjects(&a.conn()).unwrap()[0].id.clone();
    a.conn().execute("UPDATE subject SET name='Mathematik' WHERE id=?1", [&subj]).unwrap();
    repo::create_section(&b.conn(), &subj, "Geometrie", "#111").unwrap();
    onenote::trash_page(&b.conn(), &page).unwrap();
    onenote::purge_page(&b.conn(), &page).unwrap();
    let r = sync(&b, &rb, "B");
    assert_eq!(r.deleted, 1);
    let r = sync(&a, &ra, "A");
    assert_eq!(r.deleted, 1);
    assert!(repo::get_page(&a.conn(), &page).is_err());
    assert_eq!(repo::list_sections(&a.conn(), &subj).unwrap().len(), 2);
    sync(&b, &rb, "B");
    assert_eq!(repo::list_subjects(&b.conn()).unwrap()[0].name, "Mathematik");
}

/// Uhr ging beim Bearbeiten vor und ist inzwischen korrigiert: Zeit wird auf „jetzt“ begrenzt.
#[test]
fn zukunftszeit_wird_begrenzt() {
    let (a, b, ra, _, page) = setup();
    let rb = Fake { srv: ra.srv.clone(), offset: 0 };
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    repo::save_elements(&mut b.conn(), &page, &[text(&page, "t1", "B-zukunft")], &[]).unwrap();
    b.conn().execute("UPDATE page SET updated_at=?1 WHERE id=?2", params![now_ms() + 86_400_000, page]).unwrap();
    sync(&b, &rb, "B");
    repo::save_elements(&mut a.conn(), &page, &[text(&page, "t1", "A-jetzt")], &[]).unwrap();
    let r = sync(&a, &ra, "A");
    assert_eq!(r.conflicts, 1);
    assert!(content(&a, &page)[0].contains("A-jetzt"), "B's Zeit wurde beim Hochladen auf die Serverzeit begrenzt");
}

#[test]
fn papierkorb_wird_synchronisiert() {
    let (a, b, ra, rb, page) = setup();
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    onenote::trash_page(&a.conn(), &page).unwrap();
    sync(&a, &ra, "A");
    sync(&b, &rb, "B");
    let d: Option<i64> = b.conn().query_row("SELECT deleted_at FROM page WHERE id=?1", [&page], |r| r.get(0)).unwrap();
    assert!(d.is_some());
}
