//! OAuth 2.0 für Desktop-Apps (RFC 8252): Authorization Code + PKCE, Loopback-Redirect
//! `http://127.0.0.1:<zufälliger Port>`, Anmeldung im Standardbrowser.
//! Refresh-Token im Credential Manager, Access-Token nur im Arbeitsspeicher.

use super::super::{secrets, IntErr};
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// calendar.events + calendar.readonly wie gefordert; calendar.app.created erlaubt zusätzlich,
/// den eigenen Kalender „Noteforge – Schule“ anzulegen (nur Kalender, die die App selbst erstellt).
pub const SCOPES: &str = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.app.created";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

type R<T> = Result<T, IntErr>;

/// Konto-Schlüssel im Credential Manager.
pub fn secret_key(email: &str) -> String {
    format!("google:{email}")
}
pub const CLIENT_SECRET_KEY: &str = "google-client-secret";

#[derive(Debug, Clone)]
pub struct Client {
    pub id: String,
    /// Google verlangt auch bei Desktop-Clients das (nicht geheime) Client-Secret beim Token-Tausch.
    pub secret: Option<String>,
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Zufällige Bytes aus UUID v4 (Betriebssystem-Zufall).
fn random(n: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(n + 16);
    while v.len() < n {
        v.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    v.truncate(n);
    v
}

/// PKCE: (code_verifier, code_challenge S256)
pub fn pkce() -> (String, String) {
    let verifier = b64(&random(48)); // 64 Zeichen, im erlaubten Bereich 43–128
    (verifier.clone(), challenge(&verifier))
}

pub fn challenge(verifier: &str) -> String {
    b64(&Sha256::digest(verifier.as_bytes()))
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str, hint: Option<&str>) -> String {
    let mut u = url::Url::parse(AUTH_URL).expect("feste URL");
    u.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent select_account");
    if let Some(h) = hint {
        u.query_pairs_mut().append_pair("login_hint", h);
    }
    u.into()
}

/// Liest `code`/`state`/`error` aus der ersten Anfragezeile (`GET /?code=…&state=… HTTP/1.1`).
pub fn parse_redirect(request: &str) -> HashMap<String, String> {
    let path = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
    url::Url::parse(&format!("http://127.0.0.1{path}"))
        .map(|u| u.query_pairs().into_owned().collect())
        .unwrap_or_default()
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Noteforge</title><body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh\"><div><h1>Verbunden ✓</h1><p>Du kannst dieses Fenster schließen und zu Noteforge zurückkehren.</p></div>";
const PAGE_ERR: &str = "<!doctype html><meta charset=utf-8><title>Noteforge</title><body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh\"><div><h1>Anmeldung abgebrochen</h1><p>Du kannst dieses Fenster schließen.</p></div>";

/// Wartet (blockierend) auf den Redirect des Browsers und liefert den Code.
fn wait_for_code(listener: TcpListener, state: &str) -> R<String> {
    listener.set_nonblocking(true).map_err(|e| IntErr::Other(e.to_string()))?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err(IntErr::Auth("Google-Anmeldung: Zeit abgelaufen".into()));
        }
        match listener.accept() {
            Ok((mut s, _)) => {
                let _ = s.set_nonblocking(false);
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let q = parse_redirect(&req);
                // Browser fragen gelegentlich /favicon.ico an – ignorieren
                if !q.contains_key("code") && !q.contains_key("error") {
                    let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let ok = q.get("state").map(String::as_str) == Some(state) && q.contains_key("code");
                let body = if ok { PAGE_OK } else { PAGE_ERR };
                let _ = write!(
                    s,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                if let Some(e) = q.get("error") {
                    return Err(IntErr::Auth(if e == "access_denied" {
                        "Google-Anmeldung abgebrochen".into()
                    } else {
                        format!("Google-Anmeldung fehlgeschlagen: {e}")
                    }));
                }
                if !ok {
                    return Err(IntErr::Auth("Google-Anmeldung: ungültige Antwort".into()));
                }
                return Ok(q["code"].clone());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(IntErr::Other(e.to_string())),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub expires_in: u64,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: String,
}

async fn token_request(form: &[(&str, &str)]) -> R<TokenResponse> {
    let resp = reqwest::Client::new().post(TOKEN_URL).form(form).send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if status.is_success() {
        return serde_json::from_str(&text).map_err(|e| IntErr::Remote(format!("Google: {e}")));
    }
    let err: TokenError = serde_json::from_str(&text)
        .unwrap_or(TokenError { error: status.to_string(), error_description: String::new() });
    Err(match err.error.as_str() {
        "invalid_grant" => IntErr::Auth("Google: Zugriff abgelaufen oder entzogen – bitte neu anmelden".into()),
        "invalid_client" | "unauthorized_client" => {
            IntErr::Auth("Google: Client-ID/Client-Secret ungültig (Einstellungen prüfen)".into())
        }
        _ => IntErr::Remote(format!("Google: {} {}", err.error, err.error_description).trim().to_string()),
    })
}

/// Vollständige Anmeldung: Browser öffnen, Redirect abwarten, Code gegen Tokens tauschen.
/// `open` öffnet die URL im Standardbrowser.
pub async fn login(client: &Client, open: impl FnOnce(&str) -> Result<(), String>) -> R<TokenResponse> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| IntErr::Other(e.to_string()))?;
    let port = listener.local_addr().map_err(|e| IntErr::Other(e.to_string()))?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let (verifier, chal) = pkce();
    let state = b64(&random(16));
    open(&auth_url(&client.id, &redirect, &chal, &state, None)).map_err(IntErr::Other)?;
    let st = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &st))
        .await
        .map_err(|e| IntErr::Other(e.to_string()))??;
    let mut form = vec![
        ("client_id", client.id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect.as_str()),
    ];
    if let Some(s) = &client.secret {
        form.push(("client_secret", s));
    }
    let t = token_request(&form).await?;
    if t.refresh_token.is_none() {
        return Err(IntErr::Auth("Google hat kein Refresh-Token geliefert – bitte erneut anmelden".into()));
    }
    Ok(t)
}

// ---------- Access-Token-Cache und automatische Erneuerung ----------

fn cache() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static C: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

pub fn remember(email: &str, t: &TokenResponse) {
    let ttl = Duration::from_secs(t.expires_in.max(60).saturating_sub(60));
    cache().lock().unwrap_or_else(|e| e.into_inner()).insert(email.into(), (t.access_token.clone(), Instant::now() + ttl));
}

pub fn forget(email: &str) {
    cache().lock().unwrap_or_else(|e| e.into_inner()).remove(email);
}

/// Gültiges Access-Token; erneuert es bei Bedarf mit dem Refresh-Token aus dem Credential Manager.
pub async fn access_token(client: &Client, email: &str) -> R<String> {
    if let Some((t, exp)) = cache().lock().unwrap_or_else(|e| e.into_inner()).get(email).cloned()
        && Instant::now() < exp
    {
        return Ok(t);
    }
    let refresh = secrets::get(&secret_key(email))
        .map_err(IntErr::Other)?
        .ok_or_else(|| IntErr::Auth(format!("Google ({email}): Anmeldung fehlt – bitte neu verbinden")))?;
    let mut form = vec![
        ("client_id", client.id.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if let Some(s) = &client.secret {
        form.push(("client_secret", s));
    }
    let t = token_request(&form).await?;
    // Google kann ein neues Refresh-Token ausstellen (Rotation)
    if let Some(r) = &t.refresh_token {
        secrets::set(&secret_key(email), r).map_err(IntErr::Other)?;
    }
    remember(email, &t);
    Ok(t.access_token)
}

/// Zugriff bei Google widerrufen (Fehler werden ignoriert – lokal wird ohnehin gelöscht).
pub async fn revoke(email: &str) {
    if let Ok(Some(r)) = secrets::get(&secret_key(email)) {
        let _ = reqwest::Client::new().post(REVOKE_URL).form(&[("token", r.as_str())]).send().await;
    }
    forget(email);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_rfc7636_example() {
        // RFC 7636, Anhang B
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let (v, c) = pkce();
        assert!((43..=128).contains(&v.len()));
        assert_eq!(c, challenge(&v));
    }

    #[test]
    fn auth_url_has_pkce_and_loopback() {
        let u = auth_url("cid.apps.googleusercontent.com", "http://127.0.0.1:5555", "CH", "ST", None);
        let q: HashMap<String, String> = url::Url::parse(&u).unwrap().query_pairs().into_owned().collect();
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["access_type"], "offline");
        assert!(q["scope"].contains("calendar.events") && q["scope"].contains("calendar.readonly"));
    }

    #[test]
    fn redirect_parsing() {
        let q = parse_redirect("GET /?state=abc&code=4%2F0AX&scope=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(q["code"], "4/0AX");
        assert_eq!(q["state"], "abc");
        assert!(parse_redirect("GET /favicon.ico HTTP/1.1").is_empty());
    }
}
