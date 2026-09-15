-- Familienplaner – Datenbankschema
-- Im Supabase-Dashboard unter "SQL Editor" komplett einfügen und ausführen.
-- Kann gefahrlos erneut ausgeführt werden (z. B. nach einem Update).

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#4d96ff',
  avatar_url  text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Aufgaben. Leeres repeat_days = einmalig am "date".
-- Sonst wiederholt sich die Aufgabe ab "date" an den Wochentagen (1 = Mo … 7 = So),
-- optional bis "end_date".
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  member_id    uuid references public.members(id) on delete set null,
  date         date not null,
  repeat_days  smallint[] not null default '{}',
  end_date     date,
  recurring    boolean generated always as (cardinality(repeat_days) > 0) stored,
  created_at   timestamptz not null default now()
);

-- Abgehakte Aufgaben – pro Aufgabe und Tag ein Eintrag
create table if not exists public.task_completions (
  task_id       uuid not null references public.tasks(id) on delete cascade,
  date          date not null,
  completed_at  timestamptz not null default now(),
  primary key (task_id, date)
);

-- Termine. start_time leer = ganztägig. Wiederholung wie bei Aufgaben.
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  date         date not null,
  start_time   time,
  end_time     time,
  member_ids   uuid[] not null default '{}',
  note         text,
  repeat_days  smallint[] not null default '{}',
  end_date     date,
  recurring    boolean generated always as (cardinality(repeat_days) > 0) stored,
  created_at   timestamptz not null default now()
);

-- Abonnierte Kalender (iCal-Link von Google, iCloud, …)
create table if not exists public.calendars (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  url             text not null,
  member_id       uuid references public.members(id) on delete set null,
  last_synced_at  timestamptz,
  last_error      text,
  event_count     int,
  created_at      timestamptz not null default now()
);

-- Importierte Termine – werden bei jeder Synchronisierung komplett neu geschrieben
create table if not exists public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  calendar_id  uuid not null references public.calendars(id) on delete cascade,
  uid          text,
  title        text not null,
  location     text,
  date         date not null,
  end_date     date not null,
  start_time   time,
  end_time     time
);

create index if not exists tasks_date_idx on public.tasks (recurring, date);
create index if not exists events_date_idx on public.events (recurring, date);
create index if not exists completions_date_idx on public.task_completions (date);
create index if not exists calendar_events_range_idx on public.calendar_events (date, end_date);
create index if not exists calendar_events_calendar_idx on public.calendar_events (calendar_id);

-- ---------------------------------------------------------------------------
-- Zugriffsschutz: Jeder angemeldete Nutzer (= eure Familien-Accounts) darf alles.
-- WICHTIG: In Authentication → Sign In / Providers "Allow new users to sign up"
-- ausschalten, damit sich niemand Fremdes registrieren kann.
-- ---------------------------------------------------------------------------

alter table public.members          enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_completions enable row level security;
alter table public.events           enable row level security;
alter table public.calendars        enable row level security;
alter table public.calendar_events  enable row level security;

drop policy if exists "family access" on public.members;
drop policy if exists "family access" on public.tasks;
drop policy if exists "family access" on public.task_completions;
drop policy if exists "family access" on public.events;
drop policy if exists "family access" on public.calendars;
drop policy if exists "family access" on public.calendar_events;

create policy "family access" on public.members          for all to authenticated using (true) with check (true);
create policy "family access" on public.tasks            for all to authenticated using (true) with check (true);
create policy "family access" on public.task_completions for all to authenticated using (true) with check (true);
create policy "family access" on public.events           for all to authenticated using (true) with check (true);
create policy "family access" on public.calendars        for all to authenticated using (true) with check (true);
create policy "family access" on public.calendar_events  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Realtime: Änderungen vom Handy erscheinen sofort auf dem Tablet.
-- calendar_events bewusst nicht – nach einem Import ändert sich "calendars" (last_synced_at),
-- das reicht als Signal zum Neuladen.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['members', 'tasks', 'task_completions', 'events', 'calendars'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage für Profilbilder
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars read"   on storage.objects;
drop policy if exists "avatars insert" on storage.objects;
drop policy if exists "avatars update" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;

create policy "avatars read"   on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars insert" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
create policy "avatars update" on storage.objects for update to authenticated using (bucket_id = 'avatars');
create policy "avatars delete" on storage.objects for delete to authenticated using (bucket_id = 'avatars');
