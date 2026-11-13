-- WebUntis offline (SPEC §8.1): Prüfungen als Termine, Hausaufgaben, Abwesenheiten, ausstehende Noten.
-- SQLite kann CHECK-Bedingungen nicht ändern → Tabellen neu aufbauen (keine Tabelle verweist per FK darauf).

-- Termine: neue Quelle „webuntis“ (Prüfungen aus WebUntis, nicht im Nextcloud-Sync)
CREATE TABLE event_new (
  id            TEXT PRIMARY KEY,
  subject_id    TEXT REFERENCES subject(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('exam','test','deadline','other')),
  title         TEXT NOT NULL,
  start         INTEGER NOT NULL,
  "end"         INTEGER,
  note          TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL CHECK (source IN ('manual','moodle','webuntis')),
  remind_before INTEGER,
  notified      INTEGER NOT NULL DEFAULT 0,
  external_id   TEXT,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  page_id       TEXT
);
INSERT INTO event_new (id, subject_id, type, title, start, "end", note, source, remind_before, notified, external_id, updated_at, page_id)
  SELECT id, subject_id, type, title, start, "end", note, source, remind_before, notified, external_id, updated_at, page_id FROM event;
DROP TABLE event;
ALTER TABLE event_new RENAME TO event;
CREATE INDEX event_start ON event(start);
CREATE INDEX event_remind ON event(notified, start) WHERE remind_before IS NOT NULL;
CREATE UNIQUE INDEX event_external ON event(external_id) WHERE external_id IS NOT NULL;

-- Hausaufgaben: neue Quelle „webuntis“ (ID „untis:<id>“, auf allen Geräten gleich)
CREATE TABLE homework_new (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT REFERENCES subject(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  due         INTEGER,
  done_at     INTEGER,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','moodle','webuntis')),
  url         TEXT NOT NULL DEFAULT '',
  dismissed   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
INSERT INTO homework_new SELECT id, subject_id, title, note, due, done_at, source, url, dismissed, created_at, updated_at FROM homework;
DROP TABLE homework;
ALTER TABLE homework_new RENAME TO homework;
CREATE INDEX homework_due ON homework(done_at, due);

-- Noten: Status „pending“ (Arbeit geschrieben, Note fehlt noch) und „skipped“ (vom Nutzer verworfen,
-- z. B. krank – wird nicht neu angelegt). Ausstehende Einträge haben keinen Wert.
CREATE TABLE grade_new (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL REFERENCES subject(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('written','oral')),
  title       TEXT NOT NULL DEFAULT '',
  value       REAL,
  weight      REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  date        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','pending','skipped')),
  exam_key    TEXT
);
INSERT INTO grade_new (id, subject_id, kind, title, value, weight, date, created_at)
  SELECT id, subject_id, kind, title, value, weight, date, created_at FROM grade;
DROP TABLE grade;
ALTER TABLE grade_new RENAME TO grade;
CREATE INDEX grade_subject_idx ON grade(subject_id, date);

-- Abwesenheiten aus WebUntis (gerätelokaler Cache)
CREATE TABLE untis_absence (
  id     INTEGER PRIMARY KEY,
  start  INTEGER NOT NULL,
  "end"  INTEGER NOT NULL
);
CREATE INDEX untis_absence_start ON untis_absence(start);
