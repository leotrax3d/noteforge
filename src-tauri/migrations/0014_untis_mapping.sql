-- WebUntis-Fach-Zuordnung (SPEC §8 „Fach-Mapping“): Originalfach und Metadaten mitspeichern,
-- damit spätere Zuordnungen bestehende Einträge nachträglich verknüpfen können.
ALTER TABLE homework ADD COLUMN untis_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE homework ADD COLUMN assigned_at INTEGER;
ALTER TABLE homework ADD COLUMN teacher TEXT NOT NULL DEFAULT '';
ALTER TABLE event ADD COLUMN untis_subject TEXT NOT NULL DEFAULT '';
