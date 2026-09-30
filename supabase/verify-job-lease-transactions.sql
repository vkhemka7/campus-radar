-- Rollback-only lease semantics. Run in the Supabase SQL Editor after 008.
-- Restores the collect_webtools row by rolling back. No live collector lock.
begin;
do $$
declare
  acquired jsonb;
  denied jsonb;
  renewed jsonb;
  released jsonb;
  taken jsonb;
begin
  if to_regprocedure('public.try_acquire_job_lease(text,text,integer)') is null then
    raise exception 'Apply supabase/migrations/008_add_job_leases.sql before this verification';
  end if;

  update public.job_leases
  set owner_id = null, lease_expires_at = timestamptz 'epoch'
  where job_name = 'collect_webtools';

  acquired := public.try_acquire_job_lease('collect_webtools', 'owner-aaa-test', 600);
  if acquired->>'acquired' <> 'true' or acquired->>'owner_id' <> 'owner-aaa-test' then
    raise exception 'A should acquire a free lease: %', acquired;
  end if;

  denied := public.try_acquire_job_lease('collect_webtools', 'owner-bbb-test', 600);
  if denied->>'acquired' <> 'false' or denied->>'owner_id' <> 'owner-aaa-test' then
    raise exception 'B must not acquire A''s active lease: %', denied;
  end if;

  renewed := public.renew_job_lease('collect_webtools', 'owner-aaa-test', 600);
  if renewed->>'renewed' <> 'true' then
    raise exception 'A should renew its lease: %', renewed;
  end if;

  denied := public.renew_job_lease('collect_webtools', 'owner-bbb-test', 600);
  if denied->>'renewed' <> 'false' then
    raise exception 'B must not renew A''s lease: %', denied;
  end if;

  released := public.release_job_lease('collect_webtools', 'owner-bbb-test');
  if released->>'released' <> 'false' or released->>'owner_id' <> 'owner-aaa-test' then
    raise exception 'B must not release A''s lease: %', released;
  end if;

  released := public.release_job_lease('collect_webtools', 'owner-aaa-test');
  if released->>'released' <> 'true' or released->>'owner_id' is not null then
    raise exception 'A should release its lease: %', released;
  end if;

  acquired := public.try_acquire_job_lease('collect_webtools', 'owner-bbb-test', 600);
  if acquired->>'acquired' <> 'true' or acquired->>'owner_id' <> 'owner-bbb-test' then
    raise exception 'B should acquire after A releases: %', acquired;
  end if;

  update public.job_leases
  set lease_expires_at = clock_timestamp() - interval '1 second'
  where job_name = 'collect_webtools' and owner_id = 'owner-bbb-test';

  taken := public.try_acquire_job_lease('collect_webtools', 'owner-aaa-test', 600);
  if taken->>'acquired' <> 'true' or taken->>'owner_id' <> 'owner-aaa-test' then
    raise exception 'A should take over B''s expired lease: %', taken;
  end if;

  -- Concurrent callers serialize on pg_advisory_xact_lock plus one UPDATE
  -- that requires the row to be free or expired. Two owners cannot both
  -- match that WHERE clause after the first UPDATE commits.
end;
$$;
rollback;
select 'PASS: acquire, deny peer, renew, forbidden peer renew/release, release, reacquire, expired takeover; rolled back' as lease_checks;
