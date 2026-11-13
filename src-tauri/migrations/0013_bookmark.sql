-- Lesezeichen für Blätter (Seitenleiste: Reiter „Lesezeichen“).
ALTER TABLE page ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0;
