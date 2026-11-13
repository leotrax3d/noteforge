-- Bug-Reports aus der App (SPEC §15).
-- Die App meldet sich NICHT an: Sie sendet mit dem öffentlichen anon-Schlüssel und darf nur einfügen.
-- Lesen, Status ändern und Löschen dürfen ausschließlich angemeldete Admins (Tabelle public.admins).

create type public.bug_status as enum ('open', 'in_progress', 'done');

create table public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  description text not null check (char_length(btrim(description)) between 10 and 5000),
  status      public.bug_status not null default 'open',
  app_version text not null default '' check (char_length(app_version) <= 40),
  platform    text not null default '' check (char_length(platform) <= 120)
);
create index bug_reports_created_idx on public.bug_reports (created_at desc);
create index bug_reports_status_idx on public.bug_reports (status, created_at desc);

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- security definer: liest admins unabhängig von deren RLS; fester search_path gegen Umleitung
create function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create function public.bug_reports_touch() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger bug_reports_touch before update on public.bug_reports
  for each row execute function public.bug_reports_touch();

alter table public.bug_reports enable row level security;
alter table public.admins enable row level security;

-- Spaltenrechte: Absender setzen nur Text und Herkunft, nie Status/ID/Datum.
revoke all on public.bug_reports from anon, authenticated;
grant insert (description, app_version, platform) on public.bug_reports to anon, authenticated;
grant select, delete on public.bug_reports to authenticated;
grant update (status) on public.bug_reports to authenticated;

revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

create policy "Jeder darf melden" on public.bug_reports
  for insert to anon, authenticated with check (status = 'open');
create policy "Admins lesen" on public.bug_reports
  for select to authenticated using ((select public.is_admin()));
create policy "Admins ändern Status" on public.bug_reports
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins löschen" on public.bug_reports
  for delete to authenticated using ((select public.is_admin()));

-- Das Dashboard prüft damit, ob der angemeldete Nutzer Admin ist (nur die eigene Zeile sichtbar).
create policy "Eigene Admin-Zeile" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));
