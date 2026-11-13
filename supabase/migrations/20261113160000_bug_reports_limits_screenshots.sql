-- Bug-Reports: Spam-Schutz in der Datenbank und Screenshot-Anhang (SPEC §15).

-- 1) Screenshot-Pfad (Datei im privaten Bucket „bug-screenshots“) und anonymisierter Absender-Schlüssel
alter table public.bug_reports
  add column screenshot_path text check (screenshot_path ~ '^[0-9a-f]{32}\.(png|jpg)$'),
  add column client_key text not null default '';
grant insert (screenshot_path) on public.bug_reports to anon, authenticated;
-- client_key setzt nur der Trigger; Admins sehen ihn nicht über die API
revoke select on public.bug_reports from authenticated;
grant select (id, created_at, updated_at, description, status, app_version, platform, screenshot_path)
  on public.bug_reports to authenticated;

-- 2) Grenzen (SQLSTATE PT429 → PostgREST antwortet mit HTTP 429): je Absender (gehashte IP) 5 Berichte pro Stunde, insgesamt 60 pro Stunde.
create function public.bug_reports_limit() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  ip text := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
begin
  -- Tagesweise gesalzener Hash: kein Klartext-IP gespeichert, kein Verfolgen über Tage
  new.client_key := case when ip = '' then '' else md5(btrim(ip) || current_date::text || 'noteforge') end;
  if new.client_key <> '' and (select count(*) from public.bug_reports
      where client_key = new.client_key and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Zu viele Berichte in kurzer Zeit' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  if (select count(*) from public.bug_reports where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Zu viele Berichte in kurzer Zeit' using errcode = 'PT429', hint = 'rate_limit';
  end if;
  return new;
end
$$;
create trigger bug_reports_limit before insert on public.bug_reports
  for each row execute function public.bug_reports_limit();

-- 3) Privater Storage-Bucket: max. 2 MB, nur PNG/JPEG. Jeder darf hochladen, nur Admins lesen/löschen.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-screenshots', 'bug-screenshots', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "Screenshots hochladen" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'bug-screenshots' and name ~ '^[0-9a-f]{32}\.(png|jpg)$');
create policy "Admins lesen Screenshots" on storage.objects
  for select to authenticated using (bucket_id = 'bug-screenshots' and (select public.is_admin()));
create policy "Admins löschen Screenshots" on storage.objects
  for delete to authenticated using (bucket_id = 'bug-screenshots' and (select public.is_admin()));
