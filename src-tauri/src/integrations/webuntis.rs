//! WebUntis über die inoffizielle JSON-RPC-API (SPEC §8).
//! `POST https://<server>/WebUntis/jsonrpc.do?school=<schule>` mit Session-Cookie.

use super::{local_ms, IntErr};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UntisConfig {
    pub server: String,
    pub school: String,
    pub username: String,
}

/// Normalisiert Eingaben wie „https://neilo.webuntis.com/WebUntis/?school=x“ zu „neilo.webuntis.com“.
pub fn normalize_server(input: &str) -> String {
    let s = input.trim().trim_start_matches("https://").trim_start_matches("http://");
    s.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase()
}

/// Eine Stunde, wie sie im Cache landet.
#[derive(Debug, Clone, PartialEq)]
pub struct Period {
    pub id: i64,
    pub start: i64,
    pub end: i64,
    pub subject_id: Option<i64>,
    pub subject_name: String,
    pub subject_long: String,
    pub rooms: String,
    pub teachers: String,
    pub state: &'static str,
    pub info: String,
}

pub struct Session {
    client: reqwest::Client,
    url: String,
    person: (i64, i64),
}

fn names(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get("name").and_then(Value::as_str))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

/// `20261112` + `745` → ms (Ortszeit).
fn untis_time(date: i64, hm: i64) -> Option<i64> {
    let (y, m, d) = (date / 10000, (date / 100) % 100, date % 100);
    local_ms(y as i32, m as u32, d as u32, (hm / 100) as u32, (hm % 100) as u32)
}

/// Antwort von `getTimetable` → Perioden.
pub fn parse_timetable(v: &Value) -> Vec<Period> {
    let Some(arr) = v.as_array() else { return vec![] };
    let mut out: Vec<Period> = arr
        .iter()
        .filter_map(|p| {
            let date = p.get("date")?.as_i64()?;
            let start = untis_time(date, p.get("startTime")?.as_i64()?)?;
            let end = untis_time(date, p.get("endTime")?.as_i64()?)?;
            let su = p.get("su").and_then(Value::as_array).and_then(|a| a.first());
            let state = match p.get("code").and_then(Value::as_str) {
                Some("cancelled") => "cancelled",
                Some("irregular") => "irregular",
                _ => "normal",
            };
            let info = ["substText", "info", "lstext"]
                .iter()
                .filter_map(|k| p.get(*k).and_then(Value::as_str))
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            Some(Period {
                id: p.get("id")?.as_i64()?,
                start,
                end,
                subject_id: su.and_then(|s| s.get("id")).and_then(Value::as_i64),
                subject_name: su.and_then(|s| s.get("name")).and_then(Value::as_str).unwrap_or("").into(),
                subject_long: su
                    .and_then(|s| s.get("longname").or_else(|| s.get("longName")))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into(),
                rooms: names(p, "ro"),
                teachers: names(p, "te"),
                state,
                info,
            })
        })
        .collect();
    out.sort_by_key(|p| (p.start, p.id));
    out
}

fn rpc_result(v: Value) -> Result<Value, IntErr> {
    if let Some(err) = v.get("error") {
        let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
        let msg = err.get("message").and_then(Value::as_str).unwrap_or("unbekannter Fehler");
        return Err(match code {
            -8504 => IntErr::Auth("WebUntis: Benutzername oder Passwort falsch".into()),
            -8500 => IntErr::Auth("WebUntis: Schule nicht gefunden".into()),
            -8520 => IntErr::Auth("WebUntis: Sitzung abgelaufen".into()),
            -8509 => IntErr::Remote("WebUntis: keine Berechtigung für diese Daten".into()),
            _ => IntErr::Remote(format!("WebUntis: {msg} ({code})")),
        });
    }
    v.get("result").cloned().ok_or_else(|| IntErr::Remote("WebUntis: leere Antwort".into()))
}

impl Session {
    pub async fn login(cfg: &UntisConfig, password: &str) -> Result<Self, IntErr> {
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .user_agent("Noteforge")
            .timeout(std::time::Duration::from_secs(20))
            .build()?;
        let url = format!(
            "https://{}/WebUntis/jsonrpc.do?school={}",
            normalize_server(&cfg.server),
            urlencode(cfg.school.trim())
        );
        let mut s = Self { client, url, person: (0, 0) };
        let r = s
            .call("authenticate", json!({ "user": cfg.username.trim(), "password": password, "client": "Noteforge" }))
            .await?;
        let pt = r.get("personType").and_then(Value::as_i64).unwrap_or(0);
        let pid = r.get("personId").and_then(Value::as_i64).unwrap_or(0);
        let kid = r.get("klasseId").and_then(Value::as_i64).unwrap_or(0);
        // Schülerzugänge ohne Personenbezug: Klassenstundenplan
        s.person = if pid > 0 { (pt, pid) } else { (1, kid) };
        if s.person.1 == 0 {
            return Err(IntErr::Remote("WebUntis: Zugang hat keinen eigenen Stundenplan".into()));
        }
        Ok(s)
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, IntErr> {
        let body = json!({ "id": "nf", "method": method, "params": params, "jsonrpc": "2.0" });
        let resp = self.client.post(&self.url).json(&body).send().await?;
        if !resp.status().is_success() {
            return Err(IntErr::Remote(format!("WebUntis antwortet mit HTTP {}", resp.status().as_u16())));
        }
        rpc_result(resp.json::<Value>().await?)
    }

    /// Stundenplan inkl. Vertretungen/Ausfälle für [from, to] (yyyymmdd).
    pub async fn timetable(&self, from: i64, to: i64) -> Result<Vec<Period>, IntErr> {
        let r = self
            .call(
                "getTimetable",
                json!({ "options": {
                    "element": { "id": self.person.1, "type": self.person.0 },
                    "startDate": from, "endDate": to,
                    "showInfo": true, "showSubstText": true, "showLsText": true,
                    "subjectFields": ["id", "name", "longname"],
                    "roomFields": ["name"], "teacherFields": ["name"],
                }}),
            )
            .await?;
        Ok(parse_timetable(&r))
    }

    pub async fn logout(self) {
        let _ = self.call("logout", json!({})).await;
    }
}

pub fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_normalization() {
        assert_eq!(normalize_server("https://Neilo.webuntis.com/WebUntis/?school=abc#/"), "neilo.webuntis.com");
        assert_eq!(normalize_server(" mese.webuntis.com "), "mese.webuntis.com");
        assert_eq!(urlencode("Gym Über"), "Gym%20%C3%9Cber");
    }

    #[test]
    fn parses_timetable_with_substitutions() {
        let v = json!([
            { "id": 2, "date": 20261112, "startTime": 940, "endTime": 1025,
              "su": [{ "id": 7, "name": "M", "longname": "Mathematik" }],
              "ro": [{ "name": "R101" }], "te": [{ "name": "Mül" }, { "name": "" }],
              "code": "cancelled", "substText": "Entfall" },
            { "id": 1, "date": 20261112, "startTime": 745, "endTime": 830,
              "su": [{ "id": 3, "name": "D", "longname": "Deutsch" }], "ro": [], "te": [] },
            { "id": 9, "date": "kaputt" }
        ]);
        let p = parse_timetable(&v);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].subject_name, "D");
        assert_eq!(p[0].state, "normal");
        assert_eq!(p[1].state, "cancelled");
        assert_eq!(p[1].teachers, "Mül");
        assert_eq!(p[1].rooms, "R101");
        assert_eq!(p[1].info, "Entfall");
        assert_eq!(p[1].subject_long, "Mathematik");
        assert_eq!(p[0].end - p[0].start, 45 * 60_000);
        assert_eq!(p[1].start - p[0].start, 115 * 60_000);
    }

    #[test]
    fn rpc_errors_are_german() {
        let e = rpc_result(json!({ "error": { "code": -8504, "message": "bad credentials" } })).unwrap_err();
        assert!(e.to_string().contains("Passwort falsch"));
        assert_eq!(rpc_result(json!({ "result": 1 })).unwrap(), json!(1));
    }
}
