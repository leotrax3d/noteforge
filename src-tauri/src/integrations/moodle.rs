//! Moodle BW über Token + REST-Webservices (SPEC §8).

use super::IntErr;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoodleConfig {
    /// Basis-URL ohne abschließenden Slash, z. B. `https://12345.moodle.schule-bw.de`
    pub url: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoodleCourse {
    pub id: i64,
    pub fullname: String,
    pub shortname: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoodleFile {
    pub section: String,
    pub module: String,
    pub filename: String,
    pub fileurl: String,
    pub filesize: i64,
    pub modified: i64,
}

/// Abgabe/Aktion aus dem Moodle-Kalender.
#[derive(Debug, Clone, PartialEq)]
pub struct ActionEvent {
    pub id: i64,
    pub name: String,
    pub course_id: Option<i64>,
    pub course_name: String,
    pub time: i64,
    pub url: String,
}

/// Anmeldeart laut `tool_mobile_get_public_config`: 1 = App (Passwort), 2/3 = Browser/eingebettet (SSO).
pub async fn login_type(site: &str) -> Option<i64> {
    let http = reqwest::Client::builder().user_agent("Noteforge").timeout(std::time::Duration::from_secs(15)).build().ok()?;
    let v: serde_json::Value = http
        .post(format!("{site}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config"))
        .json(&serde_json::json!([{ "index": 0, "methodname": "tool_mobile_get_public_config", "args": {} }]))
        .send().await.ok()?.json().await.ok()?;
    v.get(0)?.get("data")?.get("typeoflogin")?.as_i64()
}

/// Startadresse der SSO-Anmeldung wie in der Moodle-App.
pub fn sso_launch_url(site: &str, passport: &str) -> String {
    format!("{site}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport={passport}&urlscheme=moodlemobile")
}

/// `moodlemobile://token=<base64(signatur:::token[:::privat])>` → Token, wenn die Signatur
/// md5(wwwroot + passport) passt (schützt vor untergeschobenen Tokens).
pub fn parse_sso_token(url: &str, site: &str, passport: &str) -> Result<String, String> {
    use base64::Engine;
    use md5::{Digest, Md5};
    let raw = url.split("token=").nth(1).ok_or("Moodle hat kein Token geliefert")?;
    let raw = raw.split(['&', '#']).next().unwrap_or("").trim_end_matches('/');
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(raw))
        .map_err(|_| "Moodle-Token unlesbar")?;
    let txt = String::from_utf8(bytes).map_err(|_| "Moodle-Token unlesbar")?;
    let mut parts = txt.split(":::");
    let sig = parts.next().unwrap_or("");
    let token = parts.next().unwrap_or("").to_string();
    let ok = [site.to_string(), site.replacen("https://", "http://", 1)]
        .iter()
        .any(|w| format!("{:x}", Md5::digest(format!("{w}{passport}"))) == sig);
    if !ok || token.is_empty() {
        return Err("Moodle-Anmeldung: Antwort passt nicht zu dieser Anfrage".into());
    }
    Ok(token)
}

pub fn normalize_url(input: &str) -> String {
    let mut s = input.trim().split(['?', '#']).next().unwrap_or("").trim_end_matches('/').to_string();
    // Moodle BW: Schul-Moodle liegt immer direkt auf <nummer>.moodle.bw.schule – Pfad wie /my/ oder /course/… abschneiden
    if let Some(rest) = s.split("://").last()
        && let Some((host, _)) = rest.split_once('/')
        && host.ends_with(".moodle.bw.schule")
    {
        s = format!("https://{host}");
    }
    for suffix in ["/login/index.php", "/my/index.php", "/my", "/login"] {
        if let Some(x) = s.strip_suffix(suffix) {
            s = x.trim_end_matches('/').to_string();
        }
    }
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    s
}

/// Häufige Verwechslung: das Schule@BW-Portal statt der Moodle-Adresse der Schule.
pub fn portal_hint(site: &str) -> Option<&'static str> {
    let host = site.split("://").last()?.split('/').next()?;
    (host == "bw.schule" || host == "www.bw.schule" || host == "moodle.bw.schule")
        .then_some("Das ist das Schule@BW-Portal. Bitte die Moodle-Adresse deiner Schule eintragen, z. B. https://04105764160.moodle.bw.schule (steht nach der Anmeldung oben im Browser).")
}

fn ws_error(v: &Value) -> Option<IntErr> {
    let code = v.get("errorcode").and_then(Value::as_str);
    let msg = v.get("message").or_else(|| v.get("error")).and_then(Value::as_str)?;
    Some(match code {
        Some("invalidtoken") => IntErr::Auth("Moodle: Anmeldung abgelaufen – bitte neu verbinden".into()),
        Some("invalidlogin") => IntErr::Auth("Moodle: Benutzername oder Passwort falsch".into()),
        Some("enablewsdescription") | Some("servicenotavailable") => {
            IntErr::Remote("Moodle: Die App-Schnittstelle ist auf dieser Instanz deaktiviert".into())
        }
        _ => IntErr::Remote(format!("Moodle: {msg}")),
    })
}

pub fn parse_courses(v: &Value) -> Vec<MoodleCourse> {
    let mut out: Vec<MoodleCourse> = v
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| {
            Some(MoodleCourse {
                id: c.get("id")?.as_i64()?,
                fullname: c.get("fullname").and_then(Value::as_str).unwrap_or("").into(),
                shortname: c.get("shortname").and_then(Value::as_str).unwrap_or("").into(),
            })
        })
        .collect();
    out.sort_by_key(|a| a.fullname.to_lowercase());
    out
}

/// Nur PDFs aus `core_course_get_contents`.
pub fn parse_files(v: &Value) -> Vec<MoodleFile> {
    let mut out = vec![];
    for sec in v.as_array().into_iter().flatten() {
        let sname = sec.get("name").and_then(Value::as_str).unwrap_or("");
        for m in sec.get("modules").and_then(Value::as_array).into_iter().flatten() {
            let mname = m.get("name").and_then(Value::as_str).unwrap_or("");
            for f in m.get("contents").and_then(Value::as_array).into_iter().flatten() {
                let name = f.get("filename").and_then(Value::as_str).unwrap_or("");
                let mime = f.get("mimetype").and_then(Value::as_str).unwrap_or("");
                let is_file = f.get("type").and_then(Value::as_str) == Some("file");
                if !is_file || !(mime == "application/pdf" || name.to_lowercase().ends_with(".pdf")) {
                    continue;
                }
                let Some(url) = f.get("fileurl").and_then(Value::as_str) else { continue };
                out.push(MoodleFile {
                    section: sname.into(),
                    module: mname.into(),
                    filename: name.into(),
                    fileurl: url.into(),
                    filesize: f.get("filesize").and_then(Value::as_i64).unwrap_or(0),
                    modified: f.get("timemodified").and_then(Value::as_i64).unwrap_or(0) * 1000,
                });
            }
        }
    }
    out
}

pub fn parse_action_events(v: &Value) -> Vec<ActionEvent> {
    v.get("events")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let course = e.get("course");
            Some(ActionEvent {
                id: e.get("id")?.as_i64()?,
                name: e.get("name").and_then(Value::as_str).unwrap_or("Abgabe").trim().into(),
                course_id: course.and_then(|c| c.get("id")).and_then(Value::as_i64),
                course_name: course.and_then(|c| c.get("fullname")).and_then(Value::as_str).unwrap_or("").into(),
                time: e.get("timesort").or_else(|| e.get("timestart"))?.as_i64()? * 1000,
                url: e.get("url").and_then(Value::as_str).unwrap_or("").into(),
            })
        })
        .collect()
}

pub struct Client {
    http: reqwest::Client,
    base: String,
    token: String,
}

fn http() -> Result<reqwest::Client, IntErr> {
    Ok(reqwest::Client::builder()
        .user_agent("Noteforge")
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

/// Holt ein Token für den Dienst `moodle_mobile_app`.
pub async fn fetch_token(base: &str, username: &str, password: &str) -> Result<String, IntErr> {
    let resp = http()?
        .post(format!("{base}/login/token.php"))
        .form(&[("username", username.trim()), ("password", password), ("service", "moodle_mobile_app")])
        .send()
        .await?;
    let v: Value = resp.json().await.map_err(|_| IntErr::Remote("Moodle: unerwartete Antwort – stimmt die Adresse?".into()))?;
    if let Some(t) = v.get("token").and_then(Value::as_str) {
        return Ok(t.into());
    }
    Err(ws_error(&v).unwrap_or_else(|| IntErr::Remote("Moodle: kein Token erhalten".into())))
}

impl Client {
    pub fn new(base: &str, token: &str) -> Result<Self, IntErr> {
        Ok(Self { http: http()?, base: base.into(), token: token.into() })
    }

    async fn call(&self, function: &str, params: &[(&str, String)]) -> Result<Value, IntErr> {
        let mut form: Vec<(&str, String)> = vec![
            ("wstoken", self.token.clone()),
            ("wsfunction", function.into()),
            ("moodlewsrestformat", "json".into()),
        ];
        form.extend(params.iter().cloned());
        let resp = self.http.post(format!("{}/webservice/rest/server.php", self.base)).form(&form).send().await?;
        let v: Value = resp.json().await?;
        if v.get("exception").is_some() || v.get("errorcode").is_some() {
            return Err(ws_error(&v).unwrap_or_else(|| IntErr::Remote(format!("Moodle: {function} fehlgeschlagen"))));
        }
        Ok(v)
    }

    pub async fn user_id(&self) -> Result<i64, IntErr> {
        let v = self.call("core_webservice_get_site_info", &[]).await?;
        v.get("userid").and_then(Value::as_i64).ok_or_else(|| IntErr::Remote("Moodle: keine Benutzer-ID".into()))
    }

    pub async fn courses(&self) -> Result<Vec<MoodleCourse>, IntErr> {
        let uid = self.user_id().await?;
        Ok(parse_courses(&self.call("core_enrol_get_users_courses", &[("userid", uid.to_string())]).await?))
    }

    pub async fn files(&self, course_id: i64) -> Result<Vec<MoodleFile>, IntErr> {
        Ok(parse_files(&self.call("core_course_get_contents", &[("courseid", course_id.to_string())]).await?))
    }

    pub async fn action_events(&self, from_s: i64) -> Result<Vec<ActionEvent>, IntErr> {
        let v = self
            .call(
                "core_calendar_get_action_events_by_timesort",
                &[("timesortfrom", from_s.to_string()), ("limitnum", "50".into())],
            )
            .await?;
        Ok(parse_action_events(&v))
    }

    /// Lädt eine Datei; nur URLs der eigenen Instanz (das Token verlässt sie nie).
    pub async fn download(&self, fileurl: &str) -> Result<Vec<u8>, IntErr> {
        if !same_origin(&self.base, fileurl) {
            return Err(IntErr::Remote("Moodle: Datei liegt nicht auf der verbundenen Instanz".into()));
        }
        let sep = if fileurl.contains('?') { '&' } else { '?' };
        let resp = self.http.get(format!("{fileurl}{sep}token={}", self.token)).send().await?;
        if !resp.status().is_success() {
            return Err(IntErr::Remote(format!("Moodle: Download fehlgeschlagen (HTTP {})", resp.status().as_u16())));
        }
        let bytes = resp.bytes().await?;
        if bytes.starts_with(b"{")
            && let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                return Err(ws_error(&v).unwrap_or_else(|| IntErr::Remote("Moodle: Download fehlgeschlagen".into())));
            }
        Ok(bytes.to_vec())
    }
}

pub fn same_origin(base: &str, url: &str) -> bool {
    let origin = |s: &str| {
        let rest = s.split_once("://").map(|x| x.1).unwrap_or(s);
        let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
        (s.split("://").next().unwrap_or("").to_ascii_lowercase(), host)
    };
    url.contains("://") && origin(base) == origin(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_moodle_bw_urls() {
        assert_eq!(normalize_url("https://04105764160.moodle.bw.schule/my/"), "https://04105764160.moodle.bw.schule");
        assert_eq!(normalize_url("04105764160.moodle.bw.schule/course/view.php?id=3"), "https://04105764160.moodle.bw.schule");
        assert_eq!(normalize_url("https://moodle.example.de/schule/login/index.php"), "https://moodle.example.de/schule");
        assert!(portal_hint(&normalize_url("https://bw.schule/login")).is_some());
        assert!(portal_hint("https://04105764160.moodle.bw.schule").is_none());
    }

    #[test]
    fn sso_token_signature() {
        use base64::Engine;
        use md5::{Digest, Md5};
        let site = "https://x.moodle.bw.schule";
        let sig = format!("{:x}", Md5::digest(format!("{site}p123")));
        let enc = base64::engine::general_purpose::STANDARD.encode(format!("{sig}:::tok42:::priv"));
        assert_eq!(parse_sso_token(&format!("moodlemobile://token={enc}"), site, "p123").unwrap(), "tok42");
        assert!(parse_sso_token(&format!("moodlemobile://token={enc}"), site, "anders").is_err());
        assert!(parse_sso_token("moodlemobile://nix", site, "p").is_err());
        assert_eq!(normalize_url("https://04105764160.moodle.bw.schule/my/"), "https://04105764160.moodle.bw.schule");
    }
    use serde_json::json;

    #[test]
    fn url_normalization_and_origin() {
        assert_eq!(normalize_url("schule.moodle.de/login/index.php"), "https://schule.moodle.de");
        assert_eq!(normalize_url("https://x.de/my/"), "https://x.de");
        assert!(same_origin("https://x.de", "https://X.de/webservice/pluginfile.php/1/a.pdf"));
        assert!(!same_origin("https://x.de", "https://x.de.evil.com/a.pdf"));
        assert!(!same_origin("https://x.de", "/relative"));
    }

    #[test]
    fn parses_pdfs_courses_events() {
        let contents = json!([{ "name": "Woche 1", "modules": [
            { "name": "Arbeitsblatt", "contents": [
                { "type": "file", "filename": "AB1.pdf", "mimetype": "application/pdf",
                  "fileurl": "https://x.de/webservice/pluginfile.php/1/AB1.pdf?forcedownload=1", "filesize": 10, "timemodified": 5 },
                { "type": "file", "filename": "bild.png", "mimetype": "image/png", "fileurl": "https://x.de/b.png" },
                { "type": "url", "filename": "Link", "fileurl": "https://example.org" }
            ]}
        ]}]);
        let f = parse_files(&contents);
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].section.as_str(), f[0].module.as_str(), f[0].modified), ("Woche 1", "Arbeitsblatt", 5000));

        let c = parse_courses(&json!([{ "id": 2, "fullname": "physik" }, { "id": 1, "fullname": "Mathe 10b", "shortname": "M10" }]));
        assert_eq!(c.iter().map(|x| x.id).collect::<Vec<_>>(), vec![1, 2]);

        let e = parse_action_events(&json!({ "events": [
            { "id": 4, "name": " Aufgabe 3 ist fällig ", "timesort": 1800000000, "course": { "id": 1, "fullname": "Mathe" }, "url": "u" },
            { "name": "ohne id" }
        ]}));
        assert_eq!(e.len(), 1);
        assert_eq!((e[0].name.as_str(), e[0].time, e[0].course_id), ("Aufgabe 3 ist fällig", 1_800_000_000_000, Some(1)));
    }

    #[test]
    fn maps_errors() {
        let e = ws_error(&json!({ "error": "x", "errorcode": "invalidlogin" })).unwrap();
        assert!(e.to_string().contains("Passwort falsch"));
        assert!(ws_error(&json!({ "token": "t" })).is_none());
    }
}
