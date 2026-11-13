# Bug-Reports einrichten

1. **Supabase-Projekt** anlegen (oder vorhandenes nutzen) und die Migration einspielen:
   `supabase link --project-ref <ref>` und `supabase db push` – oder den Inhalt von
   `supabase/migrations/20261113150000_bug_reports.sql` im SQL-Editor ausführen.
2. **Admin anlegen:** Authentication → Users → „Add user“ (E-Mail + Passwort). Dann im SQL-Editor:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'admin@example.org';
   ```
   Öffentliche Registrierung abschalten (Authentication → Providers → Email → „Allow new users to sign up“ aus).
3. **App:** In GitHub unter Settings → Secrets and variables → Actions → *Variables* `NOTEFORGE_SUPABASE_URL`
   und `NOTEFORGE_SUPABASE_ANON_KEY` (Project Settings → API → anon/publishable) anlegen. Der nächste Release
   enthält sie. Lokal: beide Variablen vor `pnpm tauri build` setzen.
4. **Dashboard:** dieselben zwei Werte in `admin/config.js` eintragen und den Ordner `admin/` statisch hosten
   (z. B. GitHub Pages, Netlify, oder lokal `python -m http.server` im Ordner). Unter Authentication → URL
   Configuration die Dashboard-Adresse eintragen.

Nie den `service_role`-Schlüssel verwenden – er umgeht RLS.

RLS-Tests lokal (Postgres 16 nötig): `supabase/tests/run.sh`.
