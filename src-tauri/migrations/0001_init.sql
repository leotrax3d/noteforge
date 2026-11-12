-- Phase 1: Datenmodell gemäß SPEC §3
CREATE TABLE subject (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  color               TEXT NOT NULL,
  icon                TEXT NOT NULL,
  sort_order          INTEGER NOT NULL,
  webuntis_subject_id INTEGER,
  moodle_course_id    INTEGER
);

CREATE TABLE section (
  id         TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subject(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX section_subject ON section(subject_id, sort_order);

CREATE TABLE page (
  id             TEXT PRIMARY KEY,
  section_id     TEXT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
  parent_page_id TEXT REFERENCES page(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  sort_order     INTEGER NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('infinite','a4')),
  orientation    TEXT NOT NULL CHECK (orientation IN ('portrait','landscape')),
  background     TEXT NOT NULL CHECK (background IN ('grid','lines','dots','blank')),
  bg_spacing_mm  REAL NOT NULL,
  page_color     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX page_section ON page(section_id, parent_page_id, sort_order);

CREATE TABLE element (
  id      TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  type    TEXT NOT NULL CHECK (type IN ('stroke','shape','text','image','pdfPage','file','table')),
  z       INTEGER NOT NULL,
  bbox_x  REAL NOT NULL,
  bbox_y  REAL NOT NULL,
  bbox_w  REAL NOT NULL,
  bbox_h  REAL NOT NULL,
  data    BLOB NOT NULL
);
CREATE INDEX element_page ON element(page_id, z);

CREATE TABLE tag (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  icon  TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE element_tag (
  element_id TEXT NOT NULL REFERENCES element(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (element_id, tag_id)
);

CREATE TABLE event (
  id         TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subject(id) ON DELETE SET NULL,
  type       TEXT NOT NULL CHECK (type IN ('exam','test','deadline','other')),
  title      TEXT NOT NULL,
  start      INTEGER NOT NULL,
  "end"      INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL CHECK (source IN ('manual','moodle'))
);
CREATE INDEX event_start ON event(start);

CREATE TABLE page_version (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  snapshot   BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO tag (id, name, icon, color) VALUES
  ('todo',      'To-Do',            'square-check', '#2563eb'),
  ('important', 'Wichtig',          'star',         '#dc2626'),
  ('question',  'Frage',            'circle-help',  '#9333ea'),
  ('exam-prep', 'Lernen für KA',    'graduation-cap','#16a34a');
