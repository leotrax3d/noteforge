-- Phase 7: Erkennungsergebnisse (SPEC §6) – Handschrift pro Blatt, OCR pro Bild-Element.
-- Der Hash erkennt geänderte Eingaben, damit nur bei Bedarf neu erkannt wird.
CREATE TABLE page_ink (
  page_id    TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE image_ocr (
  element_id TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL,
  hash       TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX image_ocr_page ON image_ocr(page_id);
