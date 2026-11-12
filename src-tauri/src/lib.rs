mod commands;
mod integrations;
mod onboarding;
mod shapes;
mod recognition;
mod reminders;
mod sync;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Speicherort aus dem Assistenten (Standard: App-Datenordner)
            let dir = onboarding::data_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;
            let db = db::Db::open(&dir.join(onboarding::DB_FILE))?;
            app.manage(db);
            reminders::spawn(app.handle().clone());
            sync::spawn(app.handle().clone());
            // Das Fenster startet unsichtbar und zeigt sich nach dem ersten fertigen Frame (Frontend).
            // Sicherheitsnetz, falls das Frontend nie meldet: nach 4 s trotzdem anzeigen.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            onboarding::data_location, onboarding::check_data_dir, onboarding::set_data_dir, onboarding::restart_app,
            onboarding::app_settings, onboarding::set_app_setting, onboarding::untis_search_schools,
            shapes::list_shape_templates, shapes::save_shape_template, shapes::delete_shape_template,
            sync::sync_status, sync::sync_connect, sync::sync_disconnect, sync::sync_now, sync::backup_now,
            recognition::recognition_status, recognition::recognize_strokes,
            recognition::ocr_image, recognition::recognize_page,
            commands::list_subjects, commands::create_subject, commands::update_subject,
            commands::delete_subject, commands::reorder_subjects,
            commands::list_sections, commands::create_section, commands::update_section,
            commands::delete_section, commands::reorder_sections,
            commands::list_pages, commands::create_page, commands::update_page,
            commands::delete_page, commands::move_page,
            commands::list_elements, commands::upsert_element, commands::delete_element,
            commands::save_elements,
            commands::list_tags, commands::create_tag, commands::delete_tag, commands::set_element_tag,
            commands::list_events, commands::save_event, commands::delete_event,
            commands::list_trash, commands::restore_page, commands::purge_page, commands::empty_trash,
            commands::search, commands::list_page_refs, commands::find_page,
            commands::delete_custom_tag, commands::list_page_tags, commands::set_tag_done, commands::list_tagged,
            commands::list_versions, commands::create_version, commands::auto_version,
            commands::restore_version, commands::delete_version,
            commands::list_templates, commands::save_template, commands::delete_template,
            commands::create_page_from_template, commands::write_export, commands::put_asset, commands::get_asset,
            commands::list_homework, commands::save_homework, commands::set_homework_done, commands::delete_homework,
            commands::list_grades, commands::save_grade, commands::delete_grade, commands::grade_config,
            commands::set_subject_weight, commands::set_grade_scale,
            integrations::integration_status, integrations::untis_connect, integrations::untis_disconnect,
            integrations::moodle_connect, integrations::moodle_disconnect, integrations::integrations_sync,
            integrations::list_lessons, integrations::list_untis_subjects, integrations::moodle_courses,
            integrations::moodle_course_files, integrations::moodle_download,
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
