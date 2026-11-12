-- Phase 5: Erinnerungen für Termine
ALTER TABLE event ADD COLUMN remind_before INTEGER;          -- Minuten vor Beginn, NULL = keine
ALTER TABLE event ADD COLUMN notified INTEGER NOT NULL DEFAULT 0;
CREATE INDEX event_remind ON event(notified, start) WHERE remind_before IS NOT NULL;
