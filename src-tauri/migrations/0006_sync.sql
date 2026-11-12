-- Phase 8: Sync-Zustand (SPEC §9). Bewusst ohne Fremdschlüssel: Einträge überdauern
-- das endgültige Löschen eines Blatts, damit die Löschung zum Server gelangt.
CREATE TABLE sync_page (
  page_id TEXT PRIMARY KEY,
  etag    TEXT NOT NULL,   -- ETag der Serverdatei beim letzten Abgleich
  fp      TEXT NOT NULL,   -- lokaler Fingerabdruck beim letzten Abgleich
  edited  INTEGER NOT NULL -- Bearbeitungszeit in Serverzeit (ms)
);

CREATE TABLE sync_meta (
  key   TEXT PRIMARY KEY,
  value BLOB NOT NULL
);
