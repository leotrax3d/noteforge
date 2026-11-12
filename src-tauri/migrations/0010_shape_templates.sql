-- Eigene Formvorlagen (Lasso-Auswahl → „Als Vorlage speichern“), geräteweit.
CREATE TABLE shape_template (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
