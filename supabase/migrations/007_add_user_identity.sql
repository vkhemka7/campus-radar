-- Student accounts, career interests, and per-occurrence preferences.
-- Run this in the Supabase SQL Editor after 006_atomic_occurrence_reconciliation.sql.
--
-- Occurrence identity is unchanged. User state points at event_occurrences.id.
-- A missing user_occurrence_states row means the preference is unset.
-- The public website's anon SELECT grants on events and occurrences stay as they are.
-- service_role receives no privileges on these tables.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.career_interests (
  slug text primary key,
  label text not null unique,
  sort_order integer not null
);

create table if not exists public.profile_career_interests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  interest_slug text not null references public.career_interests(slug),
  created_at timestamptz not null default now(),
  primary key (user_id, interest_slug)
);

create table if not exists public.user_occurrence_states (
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurrence_id uuid not null references public.event_occurrences(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, occurrence_id),
  constraint user_occurrence_states_status_check
    check (status in ('interested', 'going', 'not_interested'))
);

create index if not exists user_occurrence_states_occurrence_id_idx
  on public.user_occurrence_states (occurrence_id);

comment on table public.user_occurrence_states is
  'One mutually exclusive status per user and stable occurrence. No row means unset.';

insert into public.career_interests (slug, label, sort_order) values
  ('software-engineering', 'Software Engineering', 10),
  ('systems-infrastructure', 'Systems / Infrastructure', 20),
  ('ai-machine-learning', 'AI / Machine Learning', 30),
  ('data-analytics', 'Data / Analytics', 40),
  ('cybersecurity', 'Cybersecurity', 50),
  ('hardware-embedded', 'Hardware / Embedded', 60),
  ('product', 'Product', 70),
  ('fintech', 'Fintech', 80),
  ('startups-entrepreneurship', 'Startups / Entrepreneurship', 90),
  ('research', 'Research', 100),
  ('consulting', 'Consulting', 110)
on conflict (slug) do update
set label = excluded.label,
    sort_order = excluded.sort_order;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

-- Trigger functions are not RPC endpoints. PUBLIC receives EXECUTE by default.
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated, service_role;
revoke all on function public.touch_updated_at() from public, anon, authenticated, service_role;

drop trigger if exists campus_radar_create_profile on auth.users;
create trigger campus_radar_create_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists user_occurrence_states_touch_updated_at on public.user_occurrence_states;
create trigger user_occurrence_states_touch_updated_at
  before update on public.user_occurrence_states
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.career_interests enable row level security;
alter table public.profile_career_interests enable row level security;
alter table public.user_occurrence_states enable row level security;

revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.career_interests from public, anon, authenticated, service_role;
revoke all on table public.profile_career_interests from public, anon, authenticated, service_role;
revoke all on table public.user_occurrence_states from public, anon, authenticated, service_role;

grant select on table public.career_interests to anon, authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, delete on table public.profile_career_interests to authenticated;
grant select, insert, update, delete on table public.user_occurrence_states to authenticated;

drop policy if exists "Anyone can read career interests" on public.career_interests;
create policy "Anyone can read career interests"
  on public.career_interests
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Users can read their own career interests" on public.profile_career_interests;
create policy "Users can read their own career interests"
  on public.profile_career_interests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can add their own career interests" on public.profile_career_interests;
create policy "Users can add their own career interests"
  on public.profile_career_interests
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can remove their own career interests" on public.profile_career_interests;
create policy "Users can remove their own career interests"
  on public.profile_career_interests
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can read their own occurrence states" on public.user_occurrence_states;
create policy "Users can read their own occurrence states"
  on public.user_occurrence_states
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can add their own occurrence states" on public.user_occurrence_states;
create policy "Users can add their own occurrence states"
  on public.user_occurrence_states
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own occurrence states" on public.user_occurrence_states;
create policy "Users can update their own occurrence states"
  on public.user_occurrence_states
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can remove their own occurrence states" on public.user_occurrence_states;
create policy "Users can remove their own occurrence states"
  on public.user_occurrence_states
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
