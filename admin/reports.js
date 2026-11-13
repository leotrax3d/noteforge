// Reine Logik des Admin-Dashboards (getestet in src/features/feedback/admin-reports.test.ts).

export const STATUS = /** @type {const} */ ({ open: "Offen", in_progress: "In Bearbeitung", done: "Erledigt" });

/** Filtert nach Status ("all" oder Schlüssel) und Suchtext (Beschreibung, Version, Plattform). */
export function filterReports(list, { status = "all", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter((r) =>
    (status === "all" || r.status === status) &&
    (!q || [r.description, r.app_version, r.platform].some((s) => (s ?? "").toLowerCase().includes(q))));
}

/** Anzahl je Status für die Zähler-Kacheln. */
export function countByStatus(list) {
  const c = { all: list.length, open: 0, in_progress: 0, done: 0 };
  for (const r of list) if (r.status in c) c[r.status]++;
  return c;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

/** Supabase-/Netzwerkfehler → deutscher Hinweis. */
export function errorText(e) {
  const m = String(e?.message ?? e ?? "");
  if (/invalid login credentials/i.test(m)) return "E-Mail oder Passwort falsch.";
  if (/email not confirmed/i.test(m)) return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  if (/failed to fetch|network/i.test(m)) return "Keine Verbindung zu Supabase.";
  if (/jwt|expired/i.test(m)) return "Sitzung abgelaufen – bitte neu anmelden.";
  if (/permission|row-level security|42501/i.test(m)) return "Keine Berechtigung.";
  return m || "Unbekannter Fehler.";
}
