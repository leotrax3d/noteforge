mod commands;
pub mod db;

use tauri::Manager;

/// Liefert die App-Version (Rauchtest für die Tauri-Bridge).
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = db::Db::open(&dir.join("noteforge.sqlite"))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            commands::list_subjects, commands::create_subject, commands::update_subject,
            commands::delete_subject, commands::reorder_subjects,
            commands::list_sections, commands::create_section, commands::update_section,
            commands::delete_section, commands::reorder_sections,
            commands::list_pages, commands::create_page, commands::update_page,
            commands::delete_page, commands::move_page,
            commands::list_elements, commands::upsert_element, commands::delete_element,
            commands::list_tags, commands::create_tag, commands::delete_tag, commands::set_element_tag,
            commands::list_events, commands::save_event, commands::delete_event,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Noteforge");
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_set() {
        assert!(!super::app_version().is_empty());
    }
}
