-- Read-only checks for migration 007. Run this in the Supabase SQL Editor
-- after 007_add_user_identity.sql. Every boolean column must be true.
-- This script does not insert or update rows.

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.career_interests') is null
    or to_regclass('public.profile_career_interests') is null
    or to_regclass('public.user_occurrence_states') is null
    or to_regprocedure('public.create_profile_for_new_user()') is null
    or to_regprocedure('public.touch_updated_at()') is null then
    raise exception 'Apply supabase/migrations/007_add_user_identity.sql before this verification';
  end if;
end $$;

select
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) as profiles_rls,
  (select relrowsecurity from pg_class where oid = 'public.career_interests'::regclass) as interests_rls,
  (select relrowsecurity from pg_class where oid = 'public.profile_career_interests'::regclass) as profile_interests_rls,
  (select relrowsecurity from pg_class where oid = 'public.user_occurrence_states'::regclass) as occurrence_states_rls,
  has_table_privilege('anon', 'public.career_interests', 'SELECT') as anon_can_read_interests,
  not has_table_privilege('anon', 'public.profiles', 'SELECT') as anon_cannot_read_profiles,
  not has_table_privilege('anon', 'public.profile_career_interests', 'SELECT') as anon_cannot_read_profile_interests,
  not has_table_privilege('anon', 'public.user_occurrence_states', 'SELECT') as anon_cannot_read_states,
  not has_table_privilege('anon', 'public.career_interests', 'INSERT') as anon_cannot_write_interests,
  has_table_privilege('authenticated', 'public.profiles', 'SELECT') as user_can_read_profile,
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as user_can_update_profile,
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT') as user_cannot_insert_profile,
  not has_table_privilege('authenticated', 'public.profiles', 'DELETE') as user_cannot_delete_profile,
  has_table_privilege('authenticated', 'public.profile_career_interests', 'SELECT') as user_can_read_own_interests,
  has_table_privilege('authenticated', 'public.profile_career_interests', 'INSERT') as user_can_add_interests,
  has_table_privilege('authenticated', 'public.profile_career_interests', 'DELETE') as user_can_remove_interests,
  not has_table_privilege('authenticated', 'public.profile_career_interests', 'UPDATE') as user_cannot_update_interest_rows,
  has_table_privilege('authenticated', 'public.user_occurrence_states', 'SELECT') as user_can_read_states,
  has_table_privilege('authenticated', 'public.user_occurrence_states', 'INSERT') as user_can_add_states,
  has_table_privilege('authenticated', 'public.user_occurrence_states', 'UPDATE') as user_can_update_states,
  has_table_privilege('authenticated', 'public.user_occurrence_states', 'DELETE') as user_can_remove_states,
  not has_table_privilege('service_role', 'public.profiles', 'SELECT') as service_cannot_read_profiles,
  not has_table_privilege('service_role', 'public.career_interests', 'SELECT') as service_cannot_read_interests,
  not has_table_privilege('service_role', 'public.profile_career_interests', 'SELECT') as service_cannot_read_profile_interests,
  not has_table_privilege('service_role', 'public.user_occurrence_states', 'SELECT') as service_cannot_read_states,
  not has_table_privilege('authenticated', 'public.events', 'INSERT') as user_still_cannot_write_events,
  not has_table_privilege('authenticated', 'public.event_occurrences', 'INSERT') as user_still_cannot_write_occurrences,
  not has_table_privilege('anon', 'public.events', 'INSERT') as anon_still_cannot_write_events,
  has_function_privilege('service_role', 'public.reconcile_occurrence_plan(jsonb,jsonb)', 'EXECUTE') as service_can_still_reconcile,
  not has_function_privilege('anon', 'public.create_profile_for_new_user()', 'EXECUTE') as anon_cannot_call_profile_trigger,
  not has_function_privilege('authenticated', 'public.create_profile_for_new_user()', 'EXECUTE') as user_cannot_call_profile_trigger,
  not has_function_privilege('anon', 'public.touch_updated_at()', 'EXECUTE') as anon_cannot_call_touch,
  not has_function_privilege('authenticated', 'public.touch_updated_at()', 'EXECUTE') as user_cannot_call_touch;

select
  p.proname,
  p.prosecdef as security_definer,
  p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_profile_for_new_user', 'touch_updated_at')
order by p.proname;
-- Both rows: security_definer true, and config includes search_path=public.

select tgrelid::regclass as table_name, tgname
from pg_trigger
where not tgisinternal
  and tgname in (
    'campus_radar_create_profile',
    'profiles_touch_updated_at',
    'user_occurrence_states_touch_updated_at'
  )
order by tgname;
-- Expect auth.users / campus_radar_create_profile, then the two updated_at triggers.

select c.relname, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'career_interests', 'profile_career_interests', 'user_occurrence_states')
  and con.contype in ('f', 'c', 'p')
order by c.relname, con.conname;
-- user_occurrence_states.occurrence_id must reference event_occurrences(id).
-- The status check must allow only interested, going, and not_interested.
-- No foreign key may reference public.events.

select slug, label, sort_order
from public.career_interests
order by sort_order;
-- Exactly these labels, in this order:
-- Software Engineering, Systems / Infrastructure, AI / Machine Learning,
-- Data / Analytics, Cybersecurity, Hardware / Embedded, Product, Fintech,
-- Startups / Entrepreneurship, Research, Consulting.

select c.relname, p.polname, p.polcmd, p.polroles::regrole[] as roles,
  pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'career_interests', 'profile_career_interests', 'user_occurrence_states')
order by c.relname, p.polname;
-- Ten policies. Profile, interest-membership, and occurrence-state policies
-- apply to authenticated and compare user_id or id with auth.uid().
-- Career-interest vocabulary is SELECT for anon and authenticated.
