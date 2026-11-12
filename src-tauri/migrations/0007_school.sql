-- Phase 10: Hausaufgaben und Noten.
CREATE TABLE homework (
  id          TEXT PRIMARY KEY,              -- Moodle: „moodle:<Event-ID>“, auf allen Geräten gleich
  subject_id  TEXT REFERENCES subject(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  due         INTEGER,                       -- Fälligkeit (ms), NULL = ohne Termin
  done_at     INTEGER,                       -- NULL = offen
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','moodle')),
  url         TEXT NOT NULL DEFAULT '',
  dismissed   INTEGER NOT NULL DEFAULT 0,    -- Moodle-Abgabe ausgeblendet (kommt beim Abgleich nicht wieder)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX homework_due ON homework(done_at, due);

CREATE TABLE grade (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL REFERENCES subject(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('written','oral')),
  title       TEXT NOT NULL DEFAULT '',
  value       REAL NOT NULL,                 -- Note 1,0–6,0 bzw. 0–15 Punkte
  weight      REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  date        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX grade_subject_idx ON grade(subject_id, date);

-- Gewichtung je Fach (id = Fach-ID) und global (id = '*': Notensystem).
CREATE TABLE grade_config (
  id           TEXT PRIMARY KEY,
  written_pct  INTEGER CHECK (written_pct BETWEEN 0 AND 100),
  scale        TEXT CHECK (scale IN ('grades','points'))
);
CREATE TRIGGER grade_config_cleanup AFTER DELETE ON subject BEGIN
  DELETE FROM grade_config WHERE id = OLD.id;
END;
