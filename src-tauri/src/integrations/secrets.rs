//! Zugangsdaten: unter Windows ausschließlich im Credential Manager (`keyring`).
//! Auf anderen Plattformen (nur Entwicklung/CI) ein flüchtiger Speicher im Prozess –
//! niemals SQLite oder Dateien.

const SERVICE: &str = "Noteforge";

#[cfg(windows)]
mod imp {
    use super::SERVICE;
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }
    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        entry(account)?.set_password(secret).map_err(|e| format!("Credential Manager: {e}"))
    }
    pub fn get(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Credential Manager: {e}")),
        }
    }
    pub fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Credential Manager: {e}")),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    fn store() -> &'static Mutex<HashMap<String, String>> {
        static S: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        let _ = super::SERVICE;
        S.get_or_init(Default::default)
    }
    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        store().lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    pub fn get(account: &str) -> Result<Option<String>, String> {
        Ok(store().lock().unwrap().get(account).cloned())
    }
    pub fn delete(account: &str) -> Result<(), String> {
        store().lock().unwrap().remove(account);
        Ok(())
    }
}

pub use imp::{delete, get, set};

pub const UNTIS: &str = "webuntis";
pub const MOODLE: &str = "moodle-token";
