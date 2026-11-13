-- RLS-Tests für bug_reports (läuft mit run.sh gegen ein Wegwerf-Postgres oder in Supabase per psql).
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.admins (user_id) values ('00000000-0000-0000-0000-00000000000a');

create function pg_temp.expect_fail(q text, what text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'FEHLER: % war erlaubt', what;
exception when insufficient_privilege or check_violation or invalid_text_representation then
  raise notice 'ok: % verweigert', what;
end $$;

-- 1) App (anon): darf melden, aber nichts lesen/ändern/löschen und keinen Status setzen
set role anon;
insert into public.bug_reports (description, app_version, platform) values ('Absturz beim Öffnen des Kalenders', '0.2.16', 'Windows');
select pg_temp.expect_fail($q$select * from public.bug_reports$q$, 'anon liest');
select pg_temp.expect_fail($q$insert into public.bug_reports (description, status) values ('Status selbst setzen', 'done')$q$, 'anon setzt Status');
select pg_temp.expect_fail($q$insert into public.bug_reports (description) values ('kurz')$q$, 'zu kurze Meldung');
select pg_temp.expect_fail($q$update public.bug_reports set status = 'done'$q$, 'anon ändert');
select pg_temp.expect_fail($q$delete from public.bug_reports$q$, 'anon löscht');
select pg_temp.expect_fail($q$select * from public.admins$q$, 'anon liest admins');
reset role;

-- 2) Angemeldet, aber kein Admin: sieht nichts, ändert/löscht nichts
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.bug_reports (description) values ('Meldung eines normalen Nutzers');
do $$ begin
  if (select count(*) from public.bug_reports) <> 0 then raise exception 'FEHLER: Nicht-Admin liest Reports'; end if;
  update public.bug_reports set status = 'done';
  delete from public.bug_reports;
  if (select count(*) from public.admins) <> 0 then raise exception 'FEHLER: fremde Admin-Zeile sichtbar'; end if;
  raise notice 'ok: Nicht-Admin sieht/ändert nichts';
end $$;
select pg_temp.expect_fail($q$insert into public.admins values ('00000000-0000-0000-0000-00000000000b')$q$, 'Selbst zum Admin machen');
reset role;
do $$ begin
  if (select count(*) from public.bug_reports where status = 'open') <> 2 then raise exception 'FEHLER: Nicht-Admin hat geändert/gelöscht'; end if;
end $$;

-- 3) Admin: liest alles, ändert nur den Status, löscht
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare n int; begin
  if (select count(*) from public.bug_reports) <> 2 then raise exception 'FEHLER: Admin sieht nicht alles'; end if;
  if not public.is_admin() then raise exception 'FEHLER: is_admin'; end if;
  update public.bug_reports set status = 'in_progress' where description like 'Absturz%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FEHLER: Admin-Statusänderung'; end if;
  delete from public.bug_reports where description like 'Meldung%';
  if (select count(*) from public.bug_reports) <> 1 then raise exception 'FEHLER: Admin-Löschen'; end if;
  if (select updated_at > created_at from public.bug_reports) is not true then raise exception 'FEHLER: updated_at'; end if;
  raise notice 'ok: Admin liest, ändert Status, löscht';
end $$;
select pg_temp.expect_fail($q$update public.bug_reports set description = 'Text nachträglich ändern'$q$, 'Admin ändert Text');
reset role;
\echo 'Alle RLS-Tests bestanden.'
