-- Per-user record of occurrences included in a successfully sent digest.
-- Run this in the Supabase SQL Editor after 008_add_job_leases.sql.
--
-- Occurrence identity is unchanged. Rows are written only by the privileged
-- digest runner after the email provider reports success.
-- Authenticated website users cannot read or write delivery history.

create table if not exists public.user_digest_sends (
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurrence_id uuid not null references public.event_occurrences(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (user_id, occurrence_id)
);

create index if not exists user_digest_sends_occurrence_id_idx
  on public.user_digest_sends (occurrence_id);

comment on table public.user_digest_sends is
  'Occurrences emailed to a user. One row per successful send; never written before delivery succeeds.';

alter table public.user_digest_sends enable row level security;

revoke all on table public.user_digest_sends from public, anon, authenticated, service_role;

grant select on table public.career_interests to service_role;
grant select on table public.profile_career_interests to service_role;
grant select on table public.user_occurrence_states to service_role;
grant select, insert on table public.user_digest_sends to service_role;

notify pgrst, 'reload schema';
