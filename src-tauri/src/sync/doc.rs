//! Sync-Dokumente: ein gzip-JSON pro Blatt (`pages/<id>.json.gz`) und eines für die Struktur
//! (`struct.json.gz`: Fächer, Themengruppen, Tags, Vorlagen, eigene Termine).
//!
//! Zeilen werden generisch über die Spaltennamen übertragen; unbekannte Spalten (neuere
//! App-Version auf einem anderen Gerät) werden beim Einlesen ignoriert.

use crate::db::{onenote, Error, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::io::{Read, Write};

pub type Row = Map<String, Value>;
pub const FORMAT: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageDoc {
    pub v: u32,
    pub device: String,
    /// Zeitpunkt der letzten Bearbeitung in **Serverzeit** (ms) – Grundlage für „neuere Version gewinnt“.
    pub edited: i64,
    pub page: Row,
    pub elements: Vec<Row>,
    pub tags: Vec<Row>,
    /// Original-PDFs des Blatts (zoomabhängiges Rendering); fehlt in älteren Dokumenten.
    #[serde(default)]
    pub assets: Vec<Row>,
}

/// Tabelle → (id → Zeile)
pub type Tables = BTreeMap<String, BTreeMap<String, Row>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StructDoc {
    pub v: u32,
    pub device: String,
    pub tables: Tables,
}

/// Reihenfolge für Einfügen (Eltern zuerst); Löschen läuft rückwärts.
const STRUCT_TABLES: &[(&str, &str)] = &[
    ("subject", "SELECT * FROM subject"),
    ("section", "SELECT * FROM section"),
    ("tag", "SELECT * FROM tag"),
    ("template", "SELECT * FROM template"),
    // Moodle-Termine holt jedes Gerät selbst; „notified“ ist gerätelokal.
    ("event", "SELECT * FROM event WHERE source='manual'"),
    // Hausaufgaben inkl. Moodle-Abgaben (deterministische ID → Erledigt-Status gilt auf allen Geräten)
    ("homework", "SELECT * FROM homework"),
    ("grade", "SELECT * FROM grade"),
    ("grade_config", "SELECT * FROM grade_config"),
];
const LOCAL_ONLY: &[(&str, &str)] = &[("event", "notified")];

// ---------- generische Zeilen ----------

fn to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            let mut m = Map::new();
            m.insert("$b".into(), Value::String(B64.encode(b)));
            Value::Object(m)
        }
    }
}

fn to_sql(v: &Value) -> Result<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Object(m) => match m.get("$b").and_then(Value::as_str) {
            Some(b) => SqlValue::Blob(B64.decode(b).map_err(|e| Error::Invalid(format!("Sync-Daten: {e}")))?),
            None => return Err(Error::Invalid("Sync-Daten: unbekannter Wert".into())),
        },
        Value::Array(_) => return Err(Error::Invalid("Sync-Daten: unbekannter Wert".into())),
    })
}

pub fn dump(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<Vec<Row>> {
    let mut st = conn.prepare_cached(sql)?;
    let cols: Vec<String> = st.column_names().map(|s| s.to_string()).collect();
    let mut rows = st.query(p)?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        let mut m = Map::new();
        for (i, c) in cols.iter().enumerate() {
            m.insert(c.clone(), to_json(r.get_ref(i)?));
        }
        out.push(m);
    }
    Ok(out)
}

fn columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare_cached(&format!("PRAGMA table_info({table})"))?;
    let it = st.query_map([], |r| r.get::<_, String>(1))?;
    Ok(it.collect::<rusqlite::Result<_>>()?)
}

/// UPSERT per Primärschlüssel `id` (kein REPLACE: das würde Kaskaden auslösen).
pub fn upsert(conn: &Connection, table: &str, row: &Row) -> Result<()> {
    let local = columns(conn, table)?;
    let cols: Vec<&String> = local.iter().filter(|c| row.contains_key(c.as_str())).collect();
    if !cols.iter().any(|c| *c == "id") {
        return Err(Error::Invalid(format!("Sync-Daten: {table} ohne id")));
    }
    let names: Vec<String> = cols.iter().map(|c| format!("\"{c}\"")).collect();
    let marks: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let set: Vec<String> = names.iter().filter(|n| *n != "\"id\"").map(|n| format!("{n}=excluded.{n}")).collect();
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT(id) DO {}",
        names.join(","),
        marks.join(","),
        if set.is_empty() { "NOTHING".to_string() } else { format!("UPDATE SET {}", set.join(",")) }
    );
    let vals = cols.iter().map(|c| to_sql(&row[c.as_str()])).collect::<Result<Vec<_>>>()?;
    conn.prepare_cached(&sql)?.execute(params_from_iter(vals))?;
    Ok(())
}

fn id_of(r: &Row) -> String {
    match r.get("id") {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => String::new(),
    }
}

// ---------- gzip-JSON ----------

pub fn pack<T: Serialize>(v: &T) -> Result<Vec<u8>> {
    let mut z = GzEncoder::new(Vec::new(), Compression::default());
    z.write_all(&serde_json::to_vec(v)?)?;
    Ok(z.finish()?)
}

pub fn unpack<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    let mut json = Vec::new();
    GzDecoder::new(bytes).read_to_end(&mut json)?;
    Ok(serde_json::from_slice(&json)?)
}

// ---------- Blätter ----------

/// Günstiger Änderungs-Fingerabdruck eines Blatts (ohne Elementdaten zu lesen).
/// Uhrunabhängig: jede Änderung an Zeile, Elementliste oder Tags ändert ihn.
pub fn fingerprint(conn: &Connection, page_id: &str) -> Result<Option<String>> {
    let page = dump(conn, "SELECT * FROM page WHERE id=?1", [page_id])?;
    let Some(page) = page.first() else { return Ok(None) };
    let els: String = conn.query_row(
        "SELECT coalesce(group_concat(x, ';'), '') || '|' || (SELECT coalesce(group_concat(id, ','), '') FROM asset WHERE page_id=?1) FROM (SELECT id||':'||z||':'||bbox_x||':'||bbox_y||':'||bbox_w||':'||bbox_h||':'||length(data) AS x
           FROM element WHERE page_id=?1 ORDER BY id)",
        [page_id],
        |r| r.get(0),
    )?;
    let tags: String = conn.query_row(
        "SELECT coalesce(group_concat(x, ';'), '') FROM (SELECT et.element_id||':'||et.tag_id||':'||et.done AS x
           FROM element_tag et JOIN element e ON e.id=et.element_id WHERE e.page_id=?1 ORDER BY 1)",
        [page_id],
        |r| r.get(0),
    )?;
    let p = serde_json::to_vec(page)?;
    Ok(Some(crate::recognition::fnv(&[&p, els.as_bytes(), tags.as_bytes()])))
}

pub fn page_doc(conn: &Connection, page_id: &str, device: &str, edited: i64) -> Result<Option<PageDoc>> {
    let page = dump(conn, "SELECT * FROM page WHERE id=?1", [page_id])?;
    let Some(page) = page.into_iter().next() else { return Ok(None) };
    Ok(Some(PageDoc {
        v: FORMAT,
        device: device.into(),
        edited,
        page,
        elements: dump(conn, "SELECT * FROM element WHERE page_id=?1 ORDER BY z, id", [page_id])?,
        tags: dump(
            conn,
            "SELECT et.* FROM element_tag et JOIN element e ON e.id=et.element_id WHERE e.page_id=?1 ORDER BY 1, 2",
            [page_id],
        )?,
        assets: dump(conn, "SELECT * FROM asset WHERE page_id=?1 ORDER BY id", [page_id])?,
    }))
}

pub fn page_id(doc: &PageDoc) -> String {
    id_of(&doc.page)
}

/// Ersetzt ein Blatt vollständig durch den Stand aus `doc` (ohne eigene Transaktion).
pub fn apply_page(conn: &Connection, doc: &PageDoc) -> Result<()> {
    let id = page_id(doc);
    conn.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    upsert(conn, "page", &doc.page)?;
    conn.execute("DELETE FROM element WHERE page_id=?1", [&id])?;
    for e in &doc.elements {
        let mut e = e.clone();
        e.insert("page_id".into(), Value::String(id.clone()));
        upsert(conn, "element", &e)?;
    }
    let cols = columns(conn, "element_tag")?;
    for t in &doc.tags {
        let (Some(el), Some(tag)) = (t.get("element_id").and_then(Value::as_str), t.get("tag_id").and_then(Value::as_str)) else { continue };
        let known: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM tag WHERE id=?1)", [tag], |r| r.get(0))?;
        if !known {
            continue;
        }
        let done = if cols.iter().any(|c| c == "done") { t.get("done").and_then(Value::as_i64).unwrap_or(0) } else { 0 };
        conn.execute("INSERT OR REPLACE INTO element_tag (element_id, tag_id, done) VALUES (?1, ?2, ?3)", rusqlite::params![el, tag, done])?;
    }
    for a in &doc.assets {
        let mut a = a.clone();
        a.insert("page_id".into(), Value::String(id.clone()));
        upsert(conn, "asset", &a)?;
    }
    onenote::reindex_page(conn, &id)?;
    Ok(())
}

// ---------- Struktur ----------

pub fn dump_struct(conn: &Connection, device: &str) -> Result<StructDoc> {
    let mut tables = Tables::new();
    for (t, sql) in STRUCT_TABLES {
        let mut m = BTreeMap::new();
        for mut r in dump(conn, sql, [])? {
            for (lt, c) in LOCAL_ONLY {
                if lt == t {
                    r.remove(*c);
                }
            }
            m.insert(id_of(&r), r);
        }
        tables.insert(t.to_string(), m);
    }
    Ok(StructDoc { v: FORMAT, device: device.into(), tables })
}

/// Drei-Wege-Abgleich pro Eintrag gegen den Stand des letzten Syncs (`base`).
/// Nur eine Seite geändert → diese gewinnt; beide verschieden geändert → Server gewinnt.
pub fn merge(base: &Tables, local: &Tables, remote: &Tables) -> Tables {
    let empty = BTreeMap::new();
    let mut out = Tables::new();
    for (t, _) in STRUCT_TABLES {
        let (b, l, r) = (base.get(*t).unwrap_or(&empty), local.get(*t).unwrap_or(&empty), remote.get(*t).unwrap_or(&empty));
        let mut m = BTreeMap::new();
        for id in l.keys().chain(r.keys()).chain(b.keys()) {
            if m.contains_key(id) {
                continue;
            }
            let (bv, lv, rv) = (b.get(id), l.get(id), r.get(id));
            let pick = if lv == rv {
                lv
            } else if lv == bv {
                rv
            } else if rv == bv {
                lv
            } else {
                rv.or(lv)
            };
            if let Some(v) = pick {
                m.insert(id.clone(), v.clone());
            }
        }
        out.insert(t.to_string(), m);
    }
    out
}

/// Schreibt die Struktur `want` in die lokale DB (ohne eigene Transaktion). Liefert, ob sich etwas änderte.
pub fn apply_struct(conn: &Connection, have: &Tables, want: &Tables) -> Result<bool> {
    let empty = BTreeMap::new();
    let mut changed = false;
    for (t, _) in STRUCT_TABLES.iter().rev() {
        let (h, w) = (have.get(*t).unwrap_or(&empty), want.get(*t).unwrap_or(&empty));
        for id in h.keys().filter(|id| !w.contains_key(*id)) {
            conn.execute(&format!("DELETE FROM {t} WHERE id=?1"), [id])?;
            changed = true;
        }
    }
    for (t, _) in STRUCT_TABLES {
        let (h, w) = (have.get(*t).unwrap_or(&empty), want.get(*t).unwrap_or(&empty));
        for (id, row) in w {
            if h.get(id) != Some(row) {
                upsert(conn, t, row)?;
                changed = true;
            }
        }
    }
    Ok(changed)
}
