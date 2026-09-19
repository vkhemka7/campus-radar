-- CampusRadar events table.
-- Run this in the Supabase SQL Editor (see the Milestone 2 notes).
--
-- Row Level Security (RLS) is Postgres rules about which API callers may
-- read or change rows. The website uses a publishable key, which acts as
-- the `anon` role when nobody is signed in. We allow SELECT only.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  description text not null,
  category text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  timezone text not null,
  location text not null,
  registration_url text not null,
  source_url text not null unique,
  source text not null,
  discovered_at timestamptz not null
);

alter table public.events enable row level security;

revoke all on table public.events from anon, authenticated;
grant select on table public.events to anon, authenticated;

drop policy if exists "Anyone can read events" on public.events;

create policy "Anyone can read events"
  on public.events
  for select
  to anon, authenticated
  using (true);
