//! Fenstermaterial für das Glas-Design (SPEC §7.1): Mica (Windows 11) bzw. Acrylic (Windows 10).
//! Wird beim Start vor dem Anzeigen gesetzt (Einstellung `app.windowMaterial`), damit nichts flackert.

#[cfg(windows)]
fn apply_inner(w: &tauri::WebviewWindow, material: &str, dark: bool) -> String {
    use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
    let _ = clear_mica(w);
    let _ = clear_acrylic(w);
    let acrylic = |w: &tauri::WebviewWindow| {
        let tint = if dark { (18, 18, 22, 140) } else { (245, 245, 248, 120) };
        apply_acrylic(w, Some(tint)).is_ok()
    };
    match material {
        // Mica gibt es erst ab Windows 11 – sonst Acrylic
        "mica" if apply_mica(w, Some(dark)).is_ok() => "mica".into(),
        "mica" | "acrylic" if acrylic(w) => "acrylic".into(),
        _ => "off".into(),
    }
}

#[cfg(not(windows))]
fn apply_inner(_w: &tauri::WebviewWindow, _material: &str, _dark: bool) -> String {
    "off".into()
}

/// Material setzen; liefert das tatsächlich aktive Material ("mica", "acrylic" oder "off").
pub fn apply(w: &tauri::WebviewWindow, material: &str, dark: bool) -> String {
    let applied = apply_inner(w, material, dark);
    // Mit Material muss der Fensterhintergrund durchsichtig sein, sonst deckend (kein weißes Aufblitzen)
    let bg = if applied == "off" {
        if dark { tauri::window::Color(10, 10, 10, 255) } else { tauri::window::Color(255, 255, 255, 255) }
    } else {
        tauri::window::Color(0, 0, 0, 0)
    };
    let _ = w.set_background_color(Some(bg));
    applied
}

#[tauri::command]
pub fn set_window_material(window: tauri::WebviewWindow, material: String, dark: bool) -> String {
    apply(&window, &material, dark)
}

/// Windows-Einstellung „Transparenzeffekte“ (Personalisierung → Farben). true = an.
#[tauri::command]
pub fn system_transparency() -> bool {
    #[cfg(windows)]
    {
        use windows::core::w;
        use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
        let mut val: u32 = 1;
        let mut size = std::mem::size_of::<u32>() as u32;
        let r = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
                w!("EnableTransparency"),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut val as *mut u32 as *mut core::ffi::c_void),
                Some(&mut size),
            )
        };
        if r.is_ok() { val != 0 } else { true }
    }
    #[cfg(not(windows))]
    true
}
