-- Google-Kalender (SPEC §8.3). Refresh-Tokens liegen NICHT hier, sondern im Credential Manager.
-- Alle gcal_*-Tabellen sind gerätelokal (nicht Teil des Nextcloud-Syncs).

-- Letzte Änderung (für „letzte Änderung gewinnt“) und optional verknüpftes Blatt
ALTER TABLE event ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN page_id TEXT;

CREATE TABLE gcal_account (
  email        TEXT PRIMARY KEY,
  calendar_id  TEXT,                       -- Zielkalender für Noteforge → Google (NULL = noch nicht eingerichtet)
  calendar_name TEXT NOT NULL DEFAULT '',
  opts         TEXT NOT NULL DEFAULT '{}', -- JSON: welche Typen synchronisiert werden
  sync_token   TEXT,                       -- inkrementeller Abruf des Zielkalenders
  last_sync    INTEGER,
  last_error   TEXT,
  created_at   INTEGER NOT NULL
);

-- Nur lesend eingeblendete Google-Kalender (Familie, Verein …)
CREATE TABLE gcal_source (
  account      TEXT NOT NULL REFERENCES gcal_account(email) ON DELETE CASCADE,
  calendar_id  TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '#4285f4',
  sync_token   TEXT,
  PRIMARY KEY (account, calendar_id)
);

-- Zwischenspeicher der fremden Google-Termine (Quellkalender + fremde Termine im Zielkalender)
CREATE TABLE gcal_remote (
  account      TEXT NOT NULL REFERENCES gcal_account(email) ON DELETE CASCADE,
  calendar_id  TEXT NOT NULL,
  id           TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  start        INTEGER NOT NULL,
  "end"        INTEGER,
  all_day      INTEGER NOT NULL DEFAULT 0,
  location     TEXT NOT NULL DEFAULT '',
  dismissed    INTEGER NOT NULL DEFAULT 0,  -- Klassenarbeits-Vorschlag verworfen
  PRIMARY KEY (account, calendar_id, id)
);
CREATE INDEX gcal_remote_start ON gcal_remote(start);

-- Zuordnung lokal ↔ Google (zusätzlich extendedProperties.private.noteforgeId im Termin)
CREATE TABLE gcal_link (
  account      TEXT NOT NULL REFERENCES gcal_account(email) ON DELETE CASCADE,
  local_key    TEXT NOT NULL,              -- event:<id> | hw:<id> | lesson:<id>:<start> | free:<start>
  google_id    TEXT NOT NULL,
  hash         TEXT NOT NULL DEFAULT '',   -- Inhalt des zuletzt übertragenen Termins
  remote_updated INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0, -- in Google gelöscht: nicht erneut anlegen, solange unverändert
  PRIMARY KEY (account, local_key)
);

-- Termin-Verlauf: bei Konflikten bleibt die unterlegene Version hier erhalten
CREATE TABLE event_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT NOT NULL,
  snapshot     TEXT NOT NULL,              -- JSON des Termins
  origin       TEXT NOT NULL CHECK (origin IN ('local','google')),
  reason       TEXT NOT NULL DEFAULT '',
  at           INTEGER NOT NULL
);
CREATE INDEX event_history_event ON event_history(event_id, at);
