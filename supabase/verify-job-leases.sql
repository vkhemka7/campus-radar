-- Read-only privilege checks for migration 008. Run in the Supabase SQL Editor
-- after 008_add_job_leases.sql. Every boolean column must be true.
-- This script does not change lease rows.

do $$
begin
  if to_regclass('public.job_leases') is null
    or to_regprocedure('public.try_acquire_job_lease(text,text,integer)') is null
    or to_regprocedure('public.renew_job_lease(text,text,integer)') is null
    or to_regprocedure('public.release_job_lease(text,text)') is null then
    raise exception 'Apply supabase/migrations/008_add_job_leases.sql before this verification';
  end if;
end $$;

select
  (select relrowsecurity from pg_class where oid = 'public.job_leases'::regclass) as leases_rls,
  not has_table_privilege('anon', 'public.job_leases', 'SELECT') as anon_cannot_read_leases,
  not has_table_privilege('anon', 'public.job_leases', 'INSERT') as anon_cannot_insert_leases,
  not has_table_privilege('anon', 'public.job_leases', 'UPDATE') as anon_cannot_update_leases,
  not has_table_privilege('anon', 'public.job_leases', 'DELETE') as anon_cannot_delete_leases,
  not has_table_privilege('authenticated', 'public.job_leases', 'SELECT') as user_cannot_read_leases,
  not has_table_privilege('authenticated', 'public.job_leases', 'UPDATE') as user_cannot_update_leases,
  not has_table_privilege('service_role', 'public.job_leases', 'SELECT') as service_cannot_read_table,
  not has_table_privilege('service_role', 'public.job_leases', 'UPDATE') as service_cannot_update_table,
  has_function_privilege('service_role', 'public.try_acquire_job_lease(text,text,integer)', 'EXECUTE') as service_can_acquire,
  has_function_privilege('service_role', 'public.renew_job_lease(text,text,integer)', 'EXECUTE') as service_can_renew,
  has_function_privilege('service_role', 'public.release_job_lease(text,text)', 'EXECUTE') as service_can_release,
  not has_function_privilege('anon', 'public.try_acquire_job_lease(text,text,integer)', 'EXECUTE') as anon_cannot_acquire,
  not has_function_privilege('anon', 'public.renew_job_lease(text,text,integer)', 'EXECUTE') as anon_cannot_renew,
  not has_function_privilege('anon', 'public.release_job_lease(text,text)', 'EXECUTE') as anon_cannot_release,
  not has_function_privilege('authenticated', 'public.try_acquire_job_lease(text,text,integer)', 'EXECUTE') as user_cannot_acquire,
  not has_function_privilege('authenticated', 'public.renew_job_lease(text,text,integer)', 'EXECUTE') as user_cannot_renew,
  not has_function_privilege('authenticated', 'public.release_job_lease(text,text)', 'EXECUTE') as user_cannot_release;

select job_name, owner_id, lease_expires_at = timestamptz 'epoch' as unused_or_inspect_live_owner
from public.job_leases
where job_name = 'collect_webtools';
-- Expect one row. owner_id is null until a collector integration holds a lease.

select p.proname, p.prosecdef as security_definer, p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('try_acquire_job_lease', 'renew_job_lease', 'release_job_lease')
order by p.proname;
-- Three rows: security_definer true, search_path=public.
