# Bug-Reports einrichten

1. **Supabase-Projekt** anlegen (oder vorhandenes nutzen) und die Migration einspielen:
   `supabase link --project-ref <ref>` und `supabase db push` – oder den Inhalt von
   `supabase/migrations/20261113150000_bug_reports.sql` im SQL-Editor ausführen.
2. **Admin anlegen:** Authentication → Users → „Add user“ (E-Mail + Passwort). Dann im SQL-Editor:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'admin@example.org';
   ```
   Öffentliche Registrierung abschalten (Authentication → Providers → Email → „Allow new users to sign up“ aus).
3. **App:** Projekt-URL und Schlüssel stehen als Standard in `src-tauri/src/feedback.rs`. Für ein anderes Projekt in GitHub unter Settings → Secrets and variables → Actions → *Variables* `NOTEFORGE_SUPABASE_URL`
   und `NOTEFORGE_SUPABASE_ANON_KEY` (Project Settings → API → anon/publishable) anlegen. Der nächste Release
   enthält sie. Lokal: beide Variablen vor `pnpm tauri build` setzen.
4. **Dashboard:** GitHub Pages (Settings → Pages → „Deploy from a branch“, `main`, `/ (root)`) → https://leotrax3d.github.io/noteforge/admin/
   (z. B. GitHub Pages, Netlify, oder lokal `python -m http.server` im Ordner). Unter Authentication → URL
   Configuration die Dashboard-Adresse eintragen.

Nie den `service_role`-Schlüssel verwenden – er umgeht RLS.

Neue Migrationen (z. B. `…_limits_screenshots.sql`) ebenso im SQL-Editor ausführen.

RLS-Tests lokal (Postgres 16 nötig): `supabase/tests/run.sh`.
