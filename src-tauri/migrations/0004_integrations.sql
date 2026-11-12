-- Phase 6: WebUntis + Moodle BW (SPEC §8). Zugangsdaten liegen NICHT hier, sondern im Credential Manager.
CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Stundenplan-Cache (WebUntis-Perioden)
CREATE TABLE lesson (
  id                  INTEGER NOT NULL,
  start               INTEGER NOT NULL,
  "end"               INTEGER NOT NULL,
  untis_subject_id    INTEGER,
  subject_name        TEXT NOT NULL DEFAULT '',
  subject_long        TEXT NOT NULL DEFAULT '',
  rooms               TEXT NOT NULL DEFAULT '',
  teachers            TEXT NOT NULL DEFAULT '',
  state               TEXT NOT NULL DEFAULT 'normal' CHECK (state IN ('normal','cancelled','irregular')),
  info                TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id, start)
);
CREATE INDEX lesson_start ON lesson(start);

-- Moodle-Termine eindeutig zuordnen (Abgleich statt Duplikate)
ALTER TABLE event ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX event_external ON event(external_id) WHERE external_id IS NOT NULL;
