//! Minimaler WebDAV-Client für Nextcloud (PROPFIND/GET/PUT/DELETE/MKCOL).
//!
//! Zeitsynchronisation: Jede Server-Antwort trägt einen `Date`-Header (Serverzeit, UTC).
//! Daraus wird die Abweichung der lokalen Uhr bestimmt – gemessen an der Mitte der
//! Anfrage (Hin- und Rückweg), die Probe mit der kürzesten Laufzeit gewinnt.

use super::{Entry, Remote, SyncErr};
use reqwest::{header, Method, StatusCode};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

pub struct Dav {
    http: reqwest::Client,
    /// Basis-URL des Noteforge-Ordners, endet auf `/`.
    base: String,
    user: String,
    pass: String,
    /// (Laufzeit ms, Offset ms) der besten Uhrzeit-Probe.
    clock: Mutex<Option<(i64, i64)>>,
}

/// Baut die WebDAV-URL: entweder schon eine `…/remote.php/…`-Adresse oder Server + Benutzer.
pub fn dav_base(server: &str, user: &str, folder: &str) -> Result<String, SyncErr> {
    let s = server.trim().trim_end_matches('/');
    if !(s.starts_with("https://") || s.starts_with("http://")) {
        return Err(SyncErr::Config("Die Server-Adresse muss mit https:// beginnen".into()));
    }
    let root = if s.contains("/remote.php/") {
        s.to_string()
    } else {
        format!("{s}/remote.php/dav/files/{}", enc(user.trim()))
    };
    let folder: Vec<String> = folder.split('/').map(str::trim).filter(|p| !p.is_empty()).map(enc).collect();
    let folder = if folder.is_empty() { "Noteforge".to_string() } else { folder.join("/") };
    Ok(format!("{root}/{folder}/"))
}

fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'@' => o.push(b as char),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

fn now_local() -> i64 {
    crate::db::repo::now_ms()
}

pub fn norm_etag(s: &str) -> String {
    s.trim().trim_start_matches("W/").trim_matches('"').to_string()
}

pub fn http_date(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc2822(s.trim()).ok().map(|d| d.timestamp_millis())
}

impl Dav {
    pub fn new(base: String, user: String, pass: String) -> Result<Self, SyncErr> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .user_agent(concat!("Noteforge/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self { http, base, user, pass, clock: Mutex::new(None) })
    }

    async fn send(&self, m: Method, path: &str, f: impl FnOnce(reqwest::RequestBuilder) -> reqwest::RequestBuilder) -> Result<reqwest::Response, SyncErr> {
        self.send_url(m, format!("{}{path}", self.base), f).await
    }

    async fn send_url(&self, m: Method, url: String, f: impl FnOnce(reqwest::RequestBuilder) -> reqwest::RequestBuilder) -> Result<reqwest::Response, SyncErr> {
        let t0 = now_local();
        let rb = self.http.request(m, url).basic_auth(&self.user, Some(&self.pass));
        let resp = f(rb).send().await?;
        let t1 = now_local();
        if let Some(d) = resp.headers().get(header::DATE).and_then(|v| v.to_str().ok()).and_then(http_date) {
            // Date hat Sekundenauflösung (abgeschnitten) → +500 ms als Mitte.
            let rtt = t1 - t0;
            let off = d + 500 - (t0 + t1) / 2;
            // Gemeinsame Netzzeit der App (aktive Stunde, Erinnerungen …)
            crate::clock::record(t0, t1, d);
            let mut c = self.clock.lock().unwrap();
            if c.is_none_or(|(best, _)| rtt < best) {
                *c = Some((rtt, off));
            }
        }
        match resp.status() {
            StatusCode::UNAUTHORIZED => Err(SyncErr::Auth("Nextcloud hat die Anmeldung abgelehnt – App-Passwort prüfen".into())),
            StatusCode::FORBIDDEN => Err(SyncErr::Auth("Kein Zugriff auf den Nextcloud-Ordner".into())),
            StatusCode::INSUFFICIENT_STORAGE => Err(SyncErr::Remote("Der Nextcloud-Speicher ist voll".into())),
            _ => Ok(resp),
        }
    }

    fn fail(resp: &reqwest::Response, what: &str) -> SyncErr {
        SyncErr::Remote(format!("{what}: HTTP {}", resp.status().as_u16()))
    }

    async fn mkcol_url(&self, url: String) -> Result<(), SyncErr> {
        let r = self.send_url(Method::from_bytes(b"MKCOL").unwrap(), url, |b| b).await?;
        // 405 = existiert bereits
        if r.status().is_success() || r.status() == StatusCode::METHOD_NOT_ALLOWED {
            Ok(())
        } else if r.status() == StatusCode::CONFLICT {
            Err(SyncErr::Config("Übergeordneter Ordner in Nextcloud fehlt".into()))
        } else {
            Err(Self::fail(&r, "Ordner anlegen"))
        }
    }
}

const PROPFIND: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>"#;

/// Wertet eine PROPFIND-Multistatus-Antwort aus: Dateiname → (ETag, Änderungszeit).
pub fn parse_multistatus(xml: &str) -> Result<HashMap<String, Entry>, SyncErr> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| SyncErr::Remote(format!("Ungültige WebDAV-Antwort: {e}")))?;
    let dav = |n: &roxmltree::Node, name: &str| n.is_element() && n.tag_name().name() == name && n.tag_name().namespace() == Some("DAV:");
    let mut out = HashMap::new();
    for resp in doc.descendants().filter(|n| dav(n, "response")) {
        let Some(href) = resp.children().find(|n| dav(n, "href")).and_then(|n| n.text()) else { continue };
        let name = href.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
        let mut etag = None;
        let mut modified = None;
        let mut collection = false;
        for ps in resp.children().filter(|n| dav(n, "propstat")) {
            let ok = ps.children().find(|n| dav(n, "status")).and_then(|n| n.text()).is_some_and(|s| s.contains(" 200"));
            if !ok {
                continue;
            }
            for p in ps.children().filter(|n| dav(n, "prop")).flat_map(|p| p.children()) {
                if dav(&p, "getetag") {
                    etag = p.text().map(norm_etag);
                } else if dav(&p, "getlastmodified") {
                    modified = p.text().and_then(http_date);
                } else if dav(&p, "resourcetype") {
                    collection = p.children().any(|c| dav(&c, "collection"));
                }
            }
        }
        if collection || name.is_empty() {
            continue;
        }
        if let Some(etag) = etag {
            out.insert(name, Entry { etag, modified });
        }
    }
    Ok(out)
}

impl Remote for Dav {
    fn clock_offset(&self) -> Option<i64> {
        self.clock.lock().unwrap().map(|(_, o)| o)
    }

    async fn ensure_dirs(&self, dirs: &[&str]) -> Result<(), SyncErr> {
        let r = self.send_url(Method::from_bytes(b"PROPFIND").unwrap(), self.base.clone(), |b| b.header("Depth", "0")).await?;
        if r.status() == StatusCode::NOT_FOUND {
            // Basisordner (ggf. verschachtelt) unterhalb des Benutzer-Stamms anlegen
            let root = self.base.trim_end_matches('/');
            let start = ["/remote.php/dav/files/", "/remote.php/webdav/"]
                .iter()
                .find_map(|m| root.find(m).map(|i| (i + m.len(), m.contains("/files/"))));
            let Some((i, has_user)) = start else { return self.mkcol_url(self.base.clone()).await };
            let mut acc = root[..i].trim_end_matches('/').to_string();
            for (n, part) in root[i..].split('/').filter(|p| !p.is_empty()).enumerate() {
                acc.push('/');
                acc.push_str(part);
                if !(has_user && n == 0) {
                    self.mkcol_url(format!("{acc}/")).await?;
                }
            }
        } else if !r.status().is_success() && r.status().as_u16() != 207 {
            return Err(Self::fail(&r, "Ordner prüfen"));
        }
        for d in dirs {
            self.mkcol_url(format!("{}{d}/", self.base)).await?;
        }
        Ok(())
    }

    async fn list(&self, dir: &str) -> Result<HashMap<String, Entry>, SyncErr> {
        let r = self
            .send(Method::from_bytes(b"PROPFIND").unwrap(), &format!("{dir}/"), |b| {
                b.header("Depth", "1").header(header::CONTENT_TYPE, "application/xml; charset=utf-8").body(PROPFIND)
            })
            .await?;
        if r.status() == StatusCode::NOT_FOUND {
            return Ok(HashMap::new());
        }
        if r.status().as_u16() != 207 {
            return Err(Self::fail(&r, "Ordner lesen"));
        }
        parse_multistatus(&r.text().await?)
    }

    async fn get(&self, path: &str) -> Result<Option<(Vec<u8>, String)>, SyncErr> {
        let r = self.send(Method::GET, path, |b| b).await?;
        if r.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !r.status().is_success() {
            return Err(Self::fail(&r, "Herunterladen"));
        }
        let etag = r.headers().get(header::ETAG).and_then(|v| v.to_str().ok()).map(norm_etag).unwrap_or_default();
        Ok(Some((r.bytes().await?.to_vec(), etag)))
    }

    async fn put(&self, path: &str, bytes: Vec<u8>, if_match: Option<&str>) -> Result<Option<String>, SyncErr> {
        let r = self
            .send(Method::PUT, path, |b| {
                let b = b.header(header::CONTENT_TYPE, "application/gzip").body(bytes);
                match if_match {
                    Some(e) => b.header(header::IF_MATCH, format!("\"{e}\"")),
                    None => b.header(header::IF_NONE_MATCH, "*"),
                }
            })
            .await?;
        if r.status() == StatusCode::PRECONDITION_FAILED {
            return Ok(None);
        }
        if !r.status().is_success() {
            return Err(Self::fail(&r, "Hochladen"));
        }
        let h = r.headers();
        let etag = h.get("oc-etag").or_else(|| h.get(header::ETAG)).and_then(|v| v.to_str().ok()).map(norm_etag).unwrap_or_default();
        Ok(Some(etag))
    }

    async fn delete(&self, path: &str, if_match: &str) -> Result<bool, SyncErr> {
        let r = self.send(Method::DELETE, path, |b| b.header(header::IF_MATCH, format!("\"{if_match}\""))).await?;
        match r.status() {
            s if s.is_success() || s == StatusCode::NOT_FOUND => Ok(true),
            StatusCode::PRECONDITION_FAILED => Ok(false),
            _ => Err(Self::fail(&r, "Löschen")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baut_urls() {
        assert_eq!(
            dav_base("https://cloud.example.de/", "anna m", "").unwrap(),
            "https://cloud.example.de/remote.php/dav/files/anna%20m/Noteforge/"
        );
        assert_eq!(
            dav_base("https://c.de/remote.php/dav/files/x", "x", "Schule/Notizen").unwrap(),
            "https://c.de/remote.php/dav/files/x/Schule/Notizen/"
        );
        assert!(dav_base("cloud.example.de", "a", "").is_err());
    }

    #[test]
    fn liest_multistatus() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/remote.php/dav/files/a/Noteforge/pages/</d:href>
  <d:propstat><d:prop><d:getetag>"dir"</d:getetag><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/a/Noteforge/pages/p1.json.gz</d:href>
  <d:propstat><d:prop><d:getetag>"abc123"</d:getetag><d:getlastmodified>Thu, 12 Nov 2026 10:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>"#;
        let m = parse_multistatus(xml).unwrap();
        assert_eq!(m.len(), 1);
        let e = &m["p1.json.gz"];
        assert_eq!(e.etag, "abc123");
        assert_eq!(e.modified, Some(1_794_477_600_000));
    }
}
