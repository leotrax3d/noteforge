-- Binäre Quelldateien (Original-PDFs) für zoomabhängiges Rendering.
-- Pro Blatt gespeichert, damit sie mit dem Blatt synchronisiert werden.
CREATE TABLE asset (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX asset_page ON asset(page_id);
