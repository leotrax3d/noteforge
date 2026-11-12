//! Phase 7: Erkennung (SPEC §6) – Handschrift → Text über den Windows-InkAnalyzer,
//! OCR in Bildern über Windows.Media.Ocr. Beides offline; Ergebnisse landen im FTS-Index.
//! Auf anderen Plattformen (Entwicklung/CI unter Linux) melden die Befehle „nicht verfügbar“.

// Ohne Windows werden einige Hilfen nur von Tests genutzt.
#![cfg_attr(not(windows), allow(dead_code))]

#[cfg(windows)]
mod win;

use crate::db::{onenote::reindex_page, Db};
use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Punkte wie im Frontend: x, y, Druck, Neigung, t.
pub const PSTRIDE: usize = 5;
/// Index des Textmarkers in `PEN_KINDS` – Markierungen sind keine Schrift.
const PEN_HIGHLIGHTER: u8 = 3;

#[derive(Debug, thiserror::Error)]
pub enum RecErr {
    #[error("{0}")]
    Unavailable(String),
    #[error("Erkennung fehlgeschlagen: {0}")]
    Failed(String),
    #[error(transparent)]
    Db(#[from] crate::db::Error),
    #[error("Datenbankfehler: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

impl Serialize for RecErr {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type R<T> = Result<T, RecErr>;

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct Box2 {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Box2 {
    pub fn union(it: impl IntoIterator<Item = Box2>) -> Box2 {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for b in it {
            x0 = x0.min(b.x);
            y0 = y0.min(b.y);
            x1 = x1.max(b.x + b.w);
            y1 = y1.max(b.y + b.h);
        }
        if x0 > x1 { Box2::default() } else { Box2 { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RecWord {
    pub text: String,
    pub bbox: Box2,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RecLine {
    pub text: String,
    pub bbox: Box2,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct InkResult {
    pub text: String,
    pub lines: Vec<RecLine>,
    pub words: Vec<RecWord>,
}

impl InkResult {
    /// Zeilen von oben nach unten sortieren und Gesamttext bilden.
    pub fn finish(mut self) -> Self {
        self.lines.retain(|l| !l.text.trim().is_empty());
        self.lines.sort_by(|a, b| a.bbox.y.total_cmp(&b.bbox.y).then(a.bbox.x.total_cmp(&b.bbox.x)));
        self.text = self.lines.iter().map(|l| l.text.trim()).collect::<Vec<_>>().join("\n");
        self
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub lines: Vec<RecLine>,
    pub words: Vec<RecWord>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InkStrokeIn {
    pub points: Vec<f32>,
}

// ---------- Plattform ----------

#[cfg(windows)]
use win as platform;

#[cfg(not(windows))]
mod platform {
    use super::*;
    const MSG: &str = "Erkennung ist nur in der Windows-App verfügbar";
    pub fn recognize_ink(_: &[InkStrokeIn]) -> R<InkResult> {
        Err(RecErr::Unavailable(MSG.into()))
    }
    pub fn ocr(_: &[u8]) -> R<OcrResult> {
        Err(RecErr::Unavailable(MSG.into()))
    }
    pub fn ink_available() -> bool {
        false
    }
    pub fn ocr_language() -> Option<String> {
        None
    }
}

// ---------- Eingaben aus der Datenbank ----------

/// Strich-Blob (Format aus `src/canvas/core/codec.ts`) → Punkte; `None` für Textmarker/Unbekanntes.
pub fn decode_stroke(bytes: &[u8]) -> Option<InkStrokeIn> {
    if bytes.len() < 20 || bytes[0] != 1 || bytes[1] == PEN_HIGHLIGHTER {
        return None;
    }
    let n = u32::from_le_bytes(bytes[16..20].try_into().ok()?) as usize;
    let body = bytes.get(20..20 + n * PSTRIDE * 4)?;
    let points = body.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    Some(InkStrokeIn { points })
}

/// `data:image/png;base64,…` → Bytes (nur PNG/JPEG/BMP/GIF, die der Windows-Decoder sicher kann).
pub fn decode_data_url(src: &str) -> Option<Vec<u8>> {
    let rest = src.strip_prefix("data:image/")?;
    let (mime, b64) = rest.split_once(";base64,")?;
    if !matches!(mime, "png" | "jpeg" | "jpg" | "bmp" | "gif") {
        return None;
    }
    base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()
}

/// Stabiler 64-Bit-FNV-1a-Hash (unabhängig von Rust-Version/Plattform).
pub fn fnv(parts: &[&[u8]]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in parts {
        for b in p.iter().chain(&[0xff]) {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}

struct PageInput {
    ink_hash: String,
    ink_cached: bool,
    strokes: Vec<InkStrokeIn>,
    /// (Element-ID, Hash, Bytes) der Bilder, die (neu) erkannt werden müssen.
    images: Vec<(String, String, Vec<u8>)>,
}

fn page_input(conn: &Connection, page_id: &str) -> R<PageInput> {
    let mut st = conn.prepare("SELECT id, type, data FROM element WHERE page_id=?1 AND type IN ('stroke','image') ORDER BY z, id")?;
    let rows: Vec<(String, String, Vec<u8>)> =
        st.query_map([page_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    let mut strokes = vec![];
    let mut keys: Vec<&[u8]> = vec![];
    let mut images = vec![];
    for (id, kind, data) in &rows {
        if kind == "stroke" {
            if let Some(s) = decode_stroke(data) {
                strokes.push(s);
                keys.push(data);
            }
            continue;
        }
        let Some(src) = serde_json::from_slice::<serde_json::Value>(data)
            .ok()
            .and_then(|v| v["data"]["src"].as_str().map(str::to_owned))
        else {
            continue;
        };
        let hash = fnv(&[src.as_bytes()]);
        let cached: Option<String> =
            conn.query_row("SELECT hash FROM image_ocr WHERE element_id=?1", [id], |r| r.get(0)).optional()?;
        if cached.as_deref() == Some(hash.as_str()) {
            continue;
        }
        if let Some(bytes) = decode_data_url(&src) {
            images.push((id.clone(), hash, bytes));
        }
    }
    let ink_hash = fnv(&keys);
    let cached: Option<String> =
        conn.query_row("SELECT hash FROM page_ink WHERE page_id=?1", [page_id], |r| r.get(0)).optional()?;
    Ok(PageInput { ink_cached: cached.as_deref() == Some(ink_hash.as_str()), ink_hash, strokes, images })
}

fn now_ms() -> i64 {
    chrono::Local::now().timestamp_millis()
}

fn store_ink(conn: &Connection, page_id: &str, hash: &str, text: &str) -> R<()> {
    conn.execute(
        "INSERT INTO page_ink (page_id, hash, text, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(page_id) DO UPDATE SET hash=excluded.hash, text=excluded.text, updated_at=excluded.updated_at",
        params![page_id, hash, text, now_ms()],
    )?;
    Ok(())
}

fn store_ocr(conn: &Connection, page_id: &str, element_id: &str, hash: &str, text: &str) -> R<()> {
    conn.execute(
        "INSERT INTO image_ocr (element_id, page_id, hash, text, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(element_id) DO UPDATE SET page_id=excluded.page_id, hash=excluded.hash, text=excluded.text, updated_at=excluded.updated_at",
        params![element_id, page_id, hash, text, now_ms()],
    )?;
    Ok(())
}

// ---------- Befehle ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecStatus {
    pub ink: bool,
    pub ocr: bool,
    pub ocr_language: Option<String>,
}

#[tauri::command]
pub async fn recognition_status() -> RecStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let lang = platform::ocr_language();
        RecStatus { ink: platform::ink_available(), ocr: lang.is_some(), ocr_language: lang }
    })
    .await
    .unwrap_or(RecStatus { ink: false, ocr: false, ocr_language: None })
}

/// Lasso-Auswahl: Striche → Zeilen/Wörter mit Position (für „In Text umwandeln“ und Formeln).
#[tauri::command]
pub async fn recognize_strokes(strokes: Vec<InkStrokeIn>) -> R<InkResult> {
    tauri::async_runtime::spawn_blocking(move || platform::recognize_ink(&strokes))
        .await
        .map_err(|e| RecErr::Failed(e.to_string()))?
}

/// Bild (PNG/JPEG) → Text.
#[tauri::command]
pub async fn ocr_image(bytes: Vec<u8>) -> R<OcrResult> {
    tauri::async_runtime::spawn_blocking(move || platform::ocr(&bytes))
        .await
        .map_err(|e| RecErr::Failed(e.to_string()))?
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRecognition {
    /// Handschrift wurde neu erkannt.
    pub ink_updated: bool,
    /// Anzahl neu per OCR gelesener Bilder.
    pub images: usize,
    /// Erkennung auf diesem System nicht möglich.
    pub unavailable: bool,
}

/// Erkennung eines Blatts im Hintergrund aktualisieren (nur Geändertes) und den Suchindex neu bauen.
#[tauri::command]
pub async fn recognize_page(db: State<'_, Db>, page_id: String) -> R<PageRecognition> {
    let input = page_input(&db.conn(), &page_id)?;
    let mut out = PageRecognition::default();
    if input.ink_cached && input.images.is_empty() {
        return Ok(out);
    }
    let PageInput { ink_hash, ink_cached, strokes, images } = input;
    let res = tauri::async_runtime::spawn_blocking(move || {
        let ink = if ink_cached {
            None
        } else if strokes.is_empty() {
            Some(Ok(String::new()))
        } else {
            Some(platform::recognize_ink(&strokes).map(|r| r.text))
        };
        let ocr: Vec<_> = images.into_iter().map(|(id, h, b)| (id, h, platform::ocr(&b).map(|r| r.text))).collect();
        (ink, ocr)
    })
    .await
    .map_err(|e| RecErr::Failed(e.to_string()))?;

    let conn = db.conn();
    match res.0 {
        Some(Ok(text)) => {
            store_ink(&conn, &page_id, &ink_hash, &text)?;
            out.ink_updated = true;
        }
        Some(Err(RecErr::Unavailable(_))) => out.unavailable = true,
        Some(Err(e)) => return Err(e),
        None => {}
    }
    for (id, hash, r) in res.1 {
        match r {
            Ok(text) => {
                store_ocr(&conn, &page_id, &id, &hash, &text)?;
                out.images += 1;
            }
            Err(RecErr::Unavailable(_)) => out.unavailable = true,
            // Nicht lesbares Bild: leer merken, damit es nicht bei jedem Speichern erneut versucht wird
            Err(_) => store_ocr(&conn, &page_id, &id, &hash, "")?,
        }
    }
    if out.ink_updated || out.images > 0 {
        reindex_page(&conn, &page_id)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models::Element, onenote, repo};

    fn stroke_blob(pen: u8, pts: &[[f32; 5]]) -> Vec<u8> {
        let mut b = vec![1, pen, 1, 0];
        b.extend(0x112233u32.to_le_bytes());
        b.extend(2.0f32.to_le_bytes());
        b.extend(1.0f32.to_le_bytes());
        b.extend((pts.len() as u32).to_le_bytes());
        for p in pts {
            for v in p {
                b.extend(v.to_le_bytes());
            }
        }
        b
    }

    #[test]
    fn decodes_strokes_and_skips_highlighter() {
        let s = decode_stroke(&stroke_blob(1, &[[1.0, 2.0, 0.5, 0.0, 0.0], [3.0, 4.0, 0.6, 0.0, 8.0]])).unwrap();
        assert_eq!(s.points, vec![1.0, 2.0, 0.5, 0.0, 0.0, 3.0, 4.0, 0.6, 0.0, 8.0]);
        assert!(decode_stroke(&stroke_blob(PEN_HIGHLIGHTER, &[[0.0; 5]])).is_none());
        assert!(decode_stroke(&[1, 0, 0]).is_none());
        // abgeschnittene Daten
        let mut b = stroke_blob(0, &[[0.0; 5], [1.0; 5]]);
        b.truncate(30);
        assert!(decode_stroke(&b).is_none());
    }

    #[test]
    fn data_urls() {
        assert_eq!(decode_data_url("data:image/png;base64,AAEC"), Some(vec![0, 1, 2]));
        assert_eq!(decode_data_url("data:image/svg+xml;base64,AAEC"), None);
        assert_eq!(decode_data_url("https://x/y.png"), None);
    }

    #[test]
    fn hash_is_stable_and_order_sensitive() {
        assert_eq!(fnv(&[b"ab", b"c"]), fnv(&[b"ab", b"c"]));
        assert_ne!(fnv(&[b"ab", b"c"]), fnv(&[b"a", b"bc"]));
        assert_ne!(fnv(&[]), fnv(&[b""]));
    }

    #[test]
    fn finish_sorts_lines() {
        let l = |t: &str, y| RecLine { text: t.into(), bbox: Box2 { x: 0.0, y, w: 1.0, h: 1.0 } };
        let r = InkResult { lines: vec![l("zwei", 50.0), l(" ", 70.0), l("eins", 10.0)], ..Default::default() }.finish();
        assert_eq!(r.text, "eins\nzwei");
        assert_eq!(Box2::union([Box2 { x: 1.0, y: 1.0, w: 1.0, h: 1.0 }, Box2 { x: 5.0, y: 0.0, w: 1.0, h: 1.0 }]),
            Box2 { x: 1.0, y: 0.0, w: 5.0, h: 2.0 });
    }

    #[test]
    fn recognized_text_is_searchable() {
        let d = Db::open_in_memory().unwrap();
        let mut c = d.conn();
        let s = repo::create_subject(&c, "Physik", "#f00", "atom").unwrap();
        let sec = repo::create_section(&c, &s.id, "Mechanik", "#00f").unwrap();
        let p = repo::create_page(&c, &sec.id, None, "Blatt").unwrap();
        let el = |id: &str, kind: &str, data: Vec<u8>| Element {
            id: id.into(), page_id: p.id.clone(), kind: kind.into(), z: 0,
            bbox: crate::db::models::BBox { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, data,
        };
        let img = serde_json::json!({"v":1,"data":{"src":"data:image/png;base64,AAEC"}}).to_string().into_bytes();
        repo::save_elements(&mut c, &p.id, &[el("s1", "stroke", stroke_blob(0, &[[0.0; 5], [1.0; 5]])), el("i1", "image", img)], &[]).unwrap();

        let inp = page_input(&c, &p.id).unwrap();
        assert!(!inp.ink_cached);
        assert_eq!(inp.strokes.len(), 1);
        assert_eq!(inp.images.len(), 1);

        store_ink(&c, &p.id, &inp.ink_hash, "Hangabtriebskraft").unwrap();
        store_ocr(&c, &p.id, "i1", &inp.images[0].1, "Arbeitsblatt Reibung").unwrap();
        reindex_page(&c, &p.id).unwrap();
        assert_eq!(onenote::search(&c, "hangabtrieb", 10).unwrap().len(), 1);
        assert_eq!(onenote::search(&c, "reibung", 10).unwrap().len(), 1);

        // Unverändert → nichts zu tun
        let again = page_input(&c, &p.id).unwrap();
        assert!(again.ink_cached && again.images.is_empty());

        // Bild gelöscht → OCR-Text fliegt aus dem Index
        repo::save_elements(&mut c, &p.id, &[], &["i1".into()]).unwrap();
        assert!(onenote::search(&c, "reibung", 10).unwrap().is_empty());
        onenote::maintenance(&mut c).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM image_ocr", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn latex_in_text_is_indexed() {
        let j = serde_json::json!({"v":1,"data":{"html":"","latex":"\\frac{a}{b}"}}).to_string();
        assert_eq!(onenote::element_text("text", j.as_bytes()), "\\frac{a}{b}");
    }
}
