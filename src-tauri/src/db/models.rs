use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub order: i64,
    pub webuntis_subject_id: Option<i64>,
    pub moodle_course_id: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub webuntis_subject_id: Option<Option<i64>>,
    pub moodle_course_id: Option<Option<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub subject_id: String,
    pub name: String,
    pub color: String,
    pub order: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionPatch {
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub section_id: String,
    pub parent_page_id: Option<String>,
    pub title: String,
    pub order: i64,
    pub mode: String,
    pub orientation: String,
    pub background: String,
    pub bg_spacing_mm: f64,
    pub page_color: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePatch {
    pub title: Option<String>,
    pub mode: Option<String>,
    pub orientation: Option<String>,
    pub background: Option<String>,
    pub bg_spacing_mm: Option<f64>,
    pub page_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: String,
    pub page_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub z: i64,
    pub bbox: BBox,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub subject_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub start: i64,
    pub end: Option<i64>,
    pub note: String,
    pub source: String,
}
