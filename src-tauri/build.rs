fn main() {
    // Bug-Reports (SPEC §15): öffentliche Supabase-Werte beim Bauen einlesen
    println!("cargo:rerun-if-env-changed=NOTEFORGE_SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=NOTEFORGE_SUPABASE_ANON_KEY");
    tauri_build::build()
}
