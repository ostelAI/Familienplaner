-- ============================================================================
--  Familienplaner — Datenbankschema
--  Läuft im selben Supabase-Projekt wie das Haushaltsbuch und nutzt dessen
--  Haushalte: Zugriff hat nur, wer Mitglied im Haushalt ist.
--  VORAUSSETZUNG: schema.sql des Haushaltsbuchs wurde bereits ausgeführt.
--
--  Im SQL Editor komplett einfügen und ausführen. Das Skript ist wiederholbar.
-- ============================================================================

-- ---------------------------------------------------------------- Tabellen --

create table if not exists public.planner_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null,
  color         text not null default '#4d96ff',
  avatar_path   text,                                  -- Pfad im privaten Bucket
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

-- Aufgaben. Leeres repeat_days = einmalig am "date".
-- Sonst wiederholt sich die Aufgabe ab "date" an den Wochentagen (1 = Mo … 7 = So),
-- optional bis "end_date".
create table if not exists public.planner_tasks (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  title         text not null,
  member_id     uuid references public.planner_members(id) on delete set null,
  date          date not null,
  repeat_days   smallint[] not null default '{}',
  end_date      date,
  recurring     boolean generated always as (cardinality(repeat_days) > 0) stored,
  created_at    timestamptz not null default now()
);

-- Abgehakte Aufgaben – pro Aufgabe und Tag ein Eintrag
create table if not exists public.planner_completions (
  task_id       uuid not null references public.planner_tasks(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  date          date not null,
  completed_at  timestamptz not null default now(),
  primary key (task_id, date)
);

-- Eigene Termine. start_time leer = ganztägig. Wiederholung wie bei Aufgaben.
create table if not exists public.planner_events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  title         text not null,
  date          date not null,
  start_time    time,
  end_time      time,
  member_ids    uuid[] not null default '{}',
  note          text,
  repeat_days   smallint[] not null default '{}',
  end_date      date,
  recurring     boolean generated always as (cardinality(repeat_days) > 0) stored,
  created_at    timestamptz not null default now()
);

-- Abonnierte Kalender (iCal-Link von Google, iCloud, …)
create table if not exists public.planner_calendars (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text not null,
  url             text not null,
  member_id       uuid references public.planner_members(id) on delete set null,
  last_synced_at  timestamptz,
  last_error      text,
  event_count     int,
  created_at      timestamptz not null default now()
);

-- Importierte Termine – werden bei jeder Synchronisierung komplett neu geschrieben
create table if not exists public.planner_calendar_events (
  id            uuid primary key default gen_random_uuid(),
  calendar_id   uuid not null references public.planner_calendars(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  uid           text,
  title         text not null,
  location      text,
  date          date not null,
  end_date      date not null,
  start_time    time,
  end_time      time
);

create index if not exists planner_members_household_idx   on public.planner_members (household_id);
create index if not exists planner_tasks_range_idx         on public.planner_tasks (household_id, recurring, date);
create index if not exists planner_events_range_idx        on public.planner_events (household_id, recurring, date);
create index if not exists planner_completions_date_idx    on public.planner_completions (household_id, date);
create index if not exists planner_calendars_household_idx on public.planner_calendars (household_id);
create index if not exists planner_cal_events_range_idx    on public.planner_calendar_events (household_id, date, end_date);
create index if not exists planner_cal_events_calendar_idx on public.planner_calendar_events (calendar_id);

-- ------------------------------------------------------------ Zugriffsregeln --
-- Man sieht und ändert ausschließlich Daten des eigenen Haushalts
-- (public.is_member stammt aus dem Haushaltsbuch-Schema).

do $$
declare t text;
begin
  foreach t in array array[
    'planner_members', 'planner_tasks', 'planner_completions',
    'planner_events', 'planner_calendars', 'planner_calendar_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_member(household_id)) with check (public.is_member(household_id))',
      t || '_all', t
    );
  end loop;
end $$;

-- Verknüpfungen dürfen nicht auf Einträge fremder Haushalte zeigen
create or replace function public.planner_check_same_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'planner_completions' then
    if not exists (select 1 from planner_tasks where id = new.task_id and household_id = new.household_id) then
      raise exception 'Aufgabe gehört nicht zu diesem Haushalt';
    end if;
  elsif tg_table_name = 'planner_calendar_events' then
    if not exists (select 1 from planner_calendars where id = new.calendar_id and household_id = new.household_id) then
      raise exception 'Kalender gehört nicht zu diesem Haushalt';
    end if;
  elsif new.member_id is not null then
    if not exists (select 1 from planner_members where id = new.member_id and household_id = new.household_id) then
      raise exception 'Person gehört nicht zu diesem Haushalt';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.planner_check_same_household() from public, anon;

drop trigger if exists planner_same_household on public.planner_tasks;
drop trigger if exists planner_same_household on public.planner_calendars;
drop trigger if exists planner_same_household on public.planner_completions;
drop trigger if exists planner_same_household on public.planner_calendar_events;
create trigger planner_same_household before insert or update on public.planner_tasks
  for each row execute function public.planner_check_same_household();
create trigger planner_same_household before insert or update on public.planner_calendars
  for each row execute function public.planner_check_same_household();
create trigger planner_same_household before insert or update on public.planner_completions
  for each row execute function public.planner_check_same_household();
create trigger planner_same_household before insert or update on public.planner_calendar_events
  for each row execute function public.planner_check_same_household();

-- --------------------------------------------------------------- Live-Updates --
-- planner_calendar_events bewusst nicht: nach einem Import ändert sich
-- planner_calendars (last_synced_at), das reicht als Signal zum Neuladen.

do $$
declare t text;
begin
  foreach t in array array['planner_members', 'planner_tasks', 'planner_completions', 'planner_events', 'planner_calendars'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------ Profilbilder --
-- Privater Bucket: Bilder liegen unter <household_id>/<datei>.jpg und sind nur
-- für Mitglieder dieses Haushalts abrufbar (die App holt signierte Links).

insert into storage.buckets (id, name, public)
values ('planner-avatars', 'planner-avatars', false)
on conflict (id) do update set public = false;

create or replace function public.planner_avatar_allowed(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (storage.foldername(object_name))[1] ~ '^[0-9a-f-]{36}$'
      then public.is_member(((storage.foldername(object_name))[1])::uuid)
    else false
  end;
$$;

revoke all on function public.planner_avatar_allowed(text) from public, anon;
grant execute on function public.planner_avatar_allowed(text) to authenticated;

drop policy if exists "planner avatars select" on storage.objects;
drop policy if exists "planner avatars insert" on storage.objects;
drop policy if exists "planner avatars update" on storage.objects;
drop policy if exists "planner avatars delete" on storage.objects;

create policy "planner avatars select" on storage.objects for select to authenticated
  using (bucket_id = 'planner-avatars' and public.planner_avatar_allowed(name));
create policy "planner avatars insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'planner-avatars' and public.planner_avatar_allowed(name));
create policy "planner avatars update" on storage.objects for update to authenticated
  using (bucket_id = 'planner-avatars' and public.planner_avatar_allowed(name));
create policy "planner avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'planner-avatars' and public.planner_avatar_allowed(name));
