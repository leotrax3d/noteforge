-- Phase 4: Papierkorb, To-Do-Status, Volltextsuche, Versionen, Vorlagen (SPEC §5)
ALTER TABLE page ADD COLUMN deleted_at INTEGER;
CREATE INDEX page_deleted ON page(deleted_at);

ALTER TABLE element_tag ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
CREATE INDEX element_tag_tag ON element_tag(tag_id);

ALTER TABLE page_version ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE page_version ADD COLUMN element_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX page_version_page ON page_version(page_id, created_at);

-- Suchindex pro Blatt: Titel + Text aus Textfeldern/Tabellen (später + Handschrift/OCR)
CREATE VIRTUAL TABLE page_fts USING fts5(
  page_id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE template (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  snapshot   BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
