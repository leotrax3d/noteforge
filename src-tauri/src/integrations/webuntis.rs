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
    /// `https://<server>/WebUntis` für die REST-Endpunkte (gleiche Sitzung per Cookie)
    base: String,
    person: (i64, i64),
    klasse: i64,
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

/// Angekündigte Arbeit/Test.
#[derive(Debug, Clone, PartialEq)]
pub struct Exam {
    pub id: i64,
    pub start: i64,
    pub end: i64,
    pub subject_id: Option<i64>,
    pub subject: String,
    /// „exam“ (Klassenarbeit/Klausur) oder „test“
    pub kind: &'static str,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UntisHomework {
    pub id: i64,
    /// Fälligkeitstag 0:00 (Ortszeit)
    pub due: i64,
    pub subject: String,
    pub text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Absence {
    pub id: i64,
    pub start: i64,
    pub end: i64,
}

/// Prüfungsart → exam/test: „Test“, „Lernkontrolle“, „Kurzarbeit“, „Stegreif“ sind Tests.
pub fn exam_kind(label: &str) -> &'static str {
    let l = label.trim().to_lowercase();
    let test = ["test", "lernkontrolle", "lzk", "kurzarbeit", "stegreif", "hü"].iter().any(|k| l.contains(k)) || l == "ex";
    if test { "test" } else { "exam" }
}

fn i(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}
fn st(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

/// REST `/api/exams` → `{ exams: [{ id, examType, name, subject, examDate, startTime, endTime, text }] }`
pub fn parse_exams_rest(v: &Value) -> Vec<Exam> {
    let arr = v.get("exams").and_then(Value::as_array).cloned().unwrap_or_default();
    arr.iter()
        .filter_map(|e| {
            let date = i(e, "examDate")?;
            let ty = st(e, "examType");
            let name = st(e, "name");
            Some(Exam {
                id: i(e, "id")?,
                start: untis_time(date, i(e, "startTime").unwrap_or(0))?,
                end: untis_time(date, i(e, "endTime").unwrap_or(0))?,
                subject_id: None,
                subject: st(e, "subject"),
                kind: exam_kind(if ty.is_empty() { &name } else { &ty }),
                title: if name.is_empty() { ty } else { name },
                text: st(e, "text"),
            })
        })
        .collect()
}

/// JSON-RPC `getExams` → `[{ id, subject (ID), date, startTime, endTime }]`
pub fn parse_exams_rpc(v: &Value, type_label: &str) -> Vec<Exam> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let date = i(e, "date")?;
            Some(Exam {
                id: i(e, "id")?,
                start: untis_time(date, i(e, "startTime")?)?,
                end: untis_time(date, i(e, "endTime")?)?,
                subject_id: i(e, "subject"),
                subject: String::new(),
                kind: exam_kind(type_label),
                title: type_label.to_string(),
                text: String::new(),
            })
        })
        .collect()
}

/// REST `/api/homeworks/lessons` → `{ homeworks: [{ id, lessonId, dueDate, text, completed }], lessons: [{ id, subject }] }`
pub fn parse_homeworks(v: &Value) -> Vec<UntisHomework> {
    let lessons: std::collections::HashMap<i64, String> = v
        .get("lessons")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|l| Some((i(l, "id")?, st(l, "subject"))))
        .collect();
    v.get("homeworks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|h| {
            let text = st(h, "text");
            Some(UntisHomework {
                id: i(h, "id")?,
                due: untis_time(i(h, "dueDate")?, 0)?,
                subject: i(h, "lessonId").and_then(|l| lessons.get(&l).cloned()).unwrap_or_default(),
                completed: h.get("completed").and_then(Value::as_bool).unwrap_or(false),
                text: if text.is_empty() { st(h, "remark") } else { text },
            })
        })
        .collect()
}

/// REST `/api/classreg/absences/students` → `{ absences: [{ id, startDate, startTime, endDate, endTime }] }`
pub fn parse_absences(v: &Value) -> Vec<Absence> {
    v.get("absences")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|a| {
            Some(Absence {
                id: i(a, "id")?,
                start: untis_time(i(a, "startDate")?, i(a, "startTime").unwrap_or(0))?,
                end: untis_time(i(a, "endDate")?, i(a, "endTime").unwrap_or(2359))?,
            })
        })
        .collect()
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
        let base = format!("https://{}/WebUntis", normalize_server(&cfg.server));
        let url = format!("{base}/jsonrpc.do?school={}", urlencode(cfg.school.trim()));
        let mut s = Self { client, url, base, person: (0, 0), klasse: 0 };
        let r = s
            .call("authenticate", json!({ "user": cfg.username.trim(), "password": password, "client": "Noteforge" }))
            .await?;
        let pt = r.get("personType").and_then(Value::as_i64).unwrap_or(0);
        let pid = r.get("personId").and_then(Value::as_i64).unwrap_or(0);
        let kid = r.get("klasseId").and_then(Value::as_i64).unwrap_or(0);
        // Schülerzugänge ohne Personenbezug: Klassenstundenplan
        s.klasse = kid;
        s.person = if pid > 0 { (pt, pid) } else { (1, kid) };
        if s.person.1 == 0 {
            return Err(IntErr::Remote("WebUntis: Zugang hat keinen eigenen Stundenplan".into()));
        }
        Ok(s)
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, IntErr> {
        let body = json!({ "id": "nf", "method": method, "params": params, "jsonrpc": "2.0" });
        let t0 = crate::db::repo::now_ms();
        let resp = self.client.post(&self.url).json(&body).send().await?;
        crate::clock::observe(t0, &resp);
        if !resp.status().is_success() {
            return Err(IntErr::Remote(format!("WebUntis antwortet mit HTTP {}", resp.status().as_u16())));
        }
        rpc_result(resp.json::<Value>().await?)
    }

    /// Stundenplan inkl. Vertretungen/Ausfälle für [from, to] (yyyymmdd).
    pub async fn timetable(&self, from: i64, to: i64) -> Result<Vec<Period>, IntErr> {
        match self.timetable_of(self.person, from, to).await {
            // Viele Schulen sperren den persönlichen Plan für Schüler → Klassenplan
            Err(IntErr::Remote(m)) if m.contains("keine Berechtigung") && self.klasse > 0 && self.person != (1, self.klasse) => {
                self.timetable_of((1, self.klasse), from, to).await
            }
            r => r,
        }
    }

    async fn timetable_of(&self, el: (i64, i64), from: i64, to: i64) -> Result<Vec<Period>, IntErr> {
        let r = self
            .call(
                "getTimetable",
                json!({ "options": {
                    "element": { "id": el.1, "type": el.0 },
                    "startDate": from, "endDate": to,
                    "showInfo": true, "showSubstText": true, "showLsText": true,
                    "subjectFields": ["id", "name", "longname"],
                    "roomFields": ["name"], "teacherFields": ["name"],
                }}),
            )
            .await?;
        Ok(parse_timetable(&r))
    }

    /// REST-Endpunkt (`/WebUntis/api/…`) mit derselben Sitzung; liefert `data`.
    async fn rest(&self, path: &str) -> Result<Value, IntErr> {
        let resp = self.client.get(format!("{}{path}", self.base)).send().await?;
        match resp.status().as_u16() {
            200 => {}
            401 | 403 => return Err(IntErr::Remote("WebUntis: keine Berechtigung für diese Daten".into())),
            c => return Err(IntErr::Remote(format!("WebUntis antwortet mit HTTP {c}"))),
        }
        let v = resp.json::<Value>().await?;
        Ok(v.get("data").cloned().unwrap_or(v))
    }

    /// Angekündigte Prüfungen (REST, sonst JSON-RPC `getExams` je Prüfungsart).
    pub async fn exams(&self, from: i64, to: i64) -> Result<Vec<Exam>, IntErr> {
        let q = format!("/api/exams?startDate={from}&endDate={to}&studentId={}&klasseId={}", self.person.1, self.klasse);
        match self.rest(&q).await {
            Ok(v) => Ok(parse_exams_rest(&v)),
            Err(rest_err) => {
                let types = match self.call("getExamTypes", json!({})).await {
                    Ok(t) => t,
                    Err(_) => return Err(rest_err),
                };
                let mut out = Vec::new();
                for t in types.as_array().into_iter().flatten() {
                    let Some(tid) = t.get("id").and_then(Value::as_i64) else { continue };
                    let label = t.get("longName").or_else(|| t.get("name")).and_then(Value::as_str).unwrap_or("");
                    let r = self.call("getExams", json!({ "startDate": from, "endDate": to, "examTypeId": tid })).await?;
                    out.extend(parse_exams_rpc(&r, label));
                }
                Ok(out)
            }
        }
    }

    pub async fn homeworks(&self, from: i64, to: i64) -> Result<Vec<UntisHomework>, IntErr> {
        let v = self.rest(&format!("/api/homeworks/lessons?startDate={from}&endDate={to}")).await?;
        Ok(parse_homeworks(&v))
    }

    pub async fn absences(&self, from: i64, to: i64) -> Result<Vec<Absence>, IntErr> {
        let v = self
            .rest(&format!(
                "/api/classreg/absences/students?startDate={from}&endDate={to}&studentId={}&excuseStatusId=-1",
                self.person.1
            ))
            .await?;
        Ok(parse_absences(&v))
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
    fn parses_exams_homework_absences() {
        let ex = parse_exams_rest(&json!({ "exams": [
            { "id": 5, "examType": "Klassenarbeit", "name": "KA 2", "subject": "M", "examDate": 20261120, "startTime": 800, "endTime": 930 },
            { "id": 6, "examType": "Test", "name": "", "subject": "E", "examDate": 20261121, "startTime": 1000, "endTime": 1045 },
            { "id": 7 }
        ]}));
        assert_eq!(ex.len(), 2);
        assert_eq!((ex[0].kind, ex[0].title.as_str(), ex[0].subject.as_str()), ("exam", "KA 2", "M"));
        assert_eq!(ex[0].end - ex[0].start, 90 * 60_000);
        assert_eq!((ex[1].kind, ex[1].title.as_str()), ("test", "Test"));
        let rpc = parse_exams_rpc(&json!([{ "id": 1, "subject": 7, "date": 20261120, "startTime": 800, "endTime": 845 }]), "Lernkontrolle");
        assert_eq!((rpc[0].subject_id, rpc[0].kind), (Some(7), "test"));
        assert_eq!(exam_kind("Klausur"), "exam");
        assert_eq!(exam_kind("Vokabeltest"), "test");

        let hw = parse_homeworks(&json!({
            "homeworks": [{ "id": 3, "lessonId": 9, "date": 20261110, "dueDate": 20261117, "text": "S. 42 Nr. 3", "completed": false },
                          { "id": 4, "lessonId": 1, "dueDate": 20261118, "text": "", "remark": "Lesen", "completed": true }],
            "lessons": [{ "id": 9, "subject": "Mathematik" }]
        }));
        assert_eq!(hw.len(), 2);
        assert_eq!((hw[0].subject.as_str(), hw[0].text.as_str(), hw[0].completed), ("Mathematik", "S. 42 Nr. 3", false));
        assert_eq!((hw[1].subject.as_str(), hw[1].text.as_str(), hw[1].completed), ("", "Lesen", true));

        let ab = parse_absences(&json!({ "absences": [{ "id": 1, "startDate": 20261112, "startTime": 745, "endDate": 20261112, "endTime": 1300 }] }));
        assert_eq!(ab[0].end - ab[0].start, (13 * 60 - 7 * 60 - 45) * 60_000);
    }

    #[test]
    fn rpc_errors_are_german() {
        let e = rpc_result(json!({ "error": { "code": -8504, "message": "bad credentials" } })).unwrap_err();
        assert!(e.to_string().contains("Passwort falsch"));
        assert_eq!(rpc_result(json!({ "result": 1 })).unwrap(), json!(1));
    }
}

/// Live-Test gegen einen echten Server: `NF_UNTIS=server|schule|benutzer|passwort cargo test untis_live -- --ignored`
#[cfg(test)]
mod live {
    #[test]
    #[ignore]
    fn untis_live() {
        tauri::async_runtime::block_on(run());
    }
    async fn run() {
        let v = std::env::var("NF_UNTIS").expect("NF_UNTIS");
        let p: Vec<&str> = v.splitn(4, '|').collect();
        let cfg = super::UntisConfig { server: p[0].into(), school: p[1].into(), username: p[2].into() };
        let s = super::Session::login(&cfg, p[3]).await.unwrap();
        let t = s.timetable(20261109, 20261113).await.unwrap();
        assert!(!t.is_empty());
        println!("{} Stunden, z. B. {:?}", t.len(), t[0]);
    }
}
