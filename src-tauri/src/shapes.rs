//! Eigene Formvorlagen der Formen-Bibliothek (SPEC §4.3). `data` = JSON der Elemente relativ zu (0,0).

use crate::db::{Db, Error, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShapeTemplate {
    id: String,
    name: String,
    data: String,
    created_at: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<ShapeTemplate>> {
    let mut st = conn.prepare("SELECT id, name, data, created_at FROM shape_template ORDER BY created_at DESC")?;
    let rows = st.query_map([], |r| Ok(ShapeTemplate { id: r.get(0)?, name: r.get(1)?, data: r.get(2)?, created_at: r.get(3)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn save(conn: &Connection, name: &str, data: &str) -> Result<ShapeTemplate> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("Name darf nicht leer sein".into()));
    }
    serde_json::from_str::<serde_json::Value>(data)?;
    let t = ShapeTemplate { id: uuid::Uuid::new_v4().to_string(), name: name.into(), data: data.into(), created_at: crate::db::repo::now_ms() };
    conn.execute("INSERT INTO shape_template (id, name, data, created_at) VALUES (?1, ?2, ?3, ?4)", params![t.id, t.name, t.data, t.created_at])?;
    Ok(t)
}

#[tauri::command]
pub fn list_shape_templates(db: State<Db>) -> Result<Vec<ShapeTemplate>> {
    list(&db.conn())
}

#[tauri::command]
pub fn save_shape_template(db: State<Db>, name: String, data: String) -> Result<ShapeTemplate> {
    save(&db.conn(), &name, &data)
}

#[tauri::command]
pub fn delete_shape_template(db: State<Db>, id: String) -> Result<()> {
    db.conn().execute("DELETE FROM shape_template WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        assert!(save(&c, " ", "[]").is_err());
        assert!(save(&c, "Kaputt", "{").is_err());
        let t = save(&c, " Schaltung ", "[1]").unwrap();
        assert_eq!(t.name, "Schaltung");
        assert_eq!(list(&c).unwrap().len(), 1);
    }
}
