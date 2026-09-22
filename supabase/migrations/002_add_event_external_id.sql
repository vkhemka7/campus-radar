-- Add a stable source event identifier and uniqueness across Illinois calendars.
-- Run this in the Supabase SQL Editor after 001_create_events.sql.
--
-- source + external_id together identify one Illinois Webtools event even if it
-- later appears on both calendar 2654 and calendar 1002.

alter table public.events
  add column if not exists external_id text;

update public.events
set external_id = 'seed:' || id::text
where external_id is null or external_id = '';

alter table public.events
  alter column external_id set not null;

alter table public.events
  alter column discovered_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_source_external_id_key'
  ) then
    alter table public.events
      add constraint events_source_external_id_key unique (source, external_id);
  end if;
end $$;
