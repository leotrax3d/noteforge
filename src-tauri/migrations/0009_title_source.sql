-- Blatt-Titel: automatisch (aus Inhalt) oder manuell vergeben.
ALTER TABLE page ADD COLUMN title_source TEXT NOT NULL DEFAULT 'auto';
UPDATE page SET title_source='manual' WHERE trim(title) <> '';
UPDATE page SET title='Unbenannt' WHERE trim(title) = '';
