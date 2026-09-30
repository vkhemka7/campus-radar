-- Durable job leases for privileged collectors.
-- Run this in the Supabase SQL Editor after 007_add_user_identity.sql.
--
-- Session advisory locks cannot span PostgREST requests. Each REST/RPC call
-- may use a different pooled backend, so acquire/release advisory RPCs would
-- leak or no-op. This table plus one-statement RPCs is the lock.
--
-- Recommended collector settings (not enforced here; integration is later):
--   initial lease 600 seconds (10 minutes) — live HTML collection is ~4–5
--   minutes and can grow with retries, without a 30-minute static hold
--   heartbeat / renew every 120 seconds while the collector still runs
-- Crash recovery: if the process dies, the row expires by server
-- clock_timestamp() and another owner may acquire it.
--
-- Privileged collectors call these RPCs over PostgREST (service_role).

create table if not exists public.job_leases (
  job_name text primary key,
  owner_id text,
  lease_expires_at timestamptz not null default timestamptz 'epoch',
  updated_at timestamptz not null default now(),
  constraint job_leases_job_name_format
    check (job_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint job_leases_owner_id_format
    check (owner_id is null or owner_id ~ '^[A-Za-z0-9._:-]{8,128}$')
);

comment on table public.job_leases is
  'One live lease per named job. Expired owner_id rows may be taken over. Not an execution log.';

insert into public.job_leases (job_name, owner_id, lease_expires_at)
values ('collect_webtools', null, timestamptz 'epoch')
on conflict (job_name) do nothing;

alter table public.job_leases enable row level security;

revoke all on table public.job_leases from public, anon, authenticated, service_role;

create or replace function public.try_acquire_job_lease(
  p_job_name text,
  p_owner_id text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_row public.job_leases;
begin
  if p_job_name is null or p_job_name !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Invalid job lease name';
  end if;
  if p_owner_id is null or p_owner_id !~ '^[A-Za-z0-9._:-]{8,128}$' then
    raise exception 'Invalid job lease owner';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'Lease duration must be between 60 and 1800 seconds';
  end if;

  -- Serialize same-job callers in this transaction; the UPDATE then takes the row.
  perform pg_advisory_xact_lock(hashtext('campus-radar:job-lease:' || p_job_name));
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);

  update public.job_leases
  set
    owner_id = p_owner_id,
    lease_expires_at = v_until,
    updated_at = clock_timestamp()
  where job_name = p_job_name
    and (
      owner_id is null
      or lease_expires_at <= clock_timestamp()
      or owner_id = p_owner_id
    )
  returning * into v_row;

  if v_row.job_name is null then
    select * into v_row from public.job_leases where job_name = p_job_name;
    if v_row.job_name is null then
      raise exception 'Unknown job lease';
    end if;
    return jsonb_build_object(
      'acquired', false,
      'job_name', v_row.job_name,
      'owner_id', v_row.owner_id,
      'lease_expires_at', v_row.lease_expires_at
    );
  end if;

  return jsonb_build_object(
    'acquired', true,
    'job_name', v_row.job_name,
    'owner_id', v_row.owner_id,
    'lease_expires_at', v_row.lease_expires_at
  );
end;
$$;

create or replace function public.renew_job_lease(
  p_job_name text,
  p_owner_id text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_row public.job_leases;
begin
  if p_job_name is null or p_job_name !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Invalid job lease name';
  end if;
  if p_owner_id is null or p_owner_id !~ '^[A-Za-z0-9._:-]{8,128}$' then
    raise exception 'Invalid job lease owner';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'Lease duration must be between 60 and 1800 seconds';
  end if;

  perform pg_advisory_xact_lock(hashtext('campus-radar:job-lease:' || p_job_name));
  v_until := clock_timestamp() + make_interval(secs => p_lease_seconds);

  update public.job_leases
  set
    lease_expires_at = v_until,
    updated_at = clock_timestamp()
  where job_name = p_job_name
    and owner_id = p_owner_id
    and lease_expires_at > clock_timestamp()
  returning * into v_row;

  if v_row.job_name is null then
    select * into v_row from public.job_leases where job_name = p_job_name;
    return jsonb_build_object(
      'renewed', false,
      'job_name', p_job_name,
      'owner_id', v_row.owner_id,
      'lease_expires_at', v_row.lease_expires_at
    );
  end if;

  return jsonb_build_object(
    'renewed', true,
    'job_name', v_row.job_name,
    'owner_id', v_row.owner_id,
    'lease_expires_at', v_row.lease_expires_at
  );
end;
$$;

create or replace function public.release_job_lease(
  p_job_name text,
  p_owner_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.job_leases;
  v_released boolean := false;
begin
  if p_job_name is null or p_job_name !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Invalid job lease name';
  end if;
  if p_owner_id is null or p_owner_id !~ '^[A-Za-z0-9._:-]{8,128}$' then
    raise exception 'Invalid job lease owner';
  end if;

  perform pg_advisory_xact_lock(hashtext('campus-radar:job-lease:' || p_job_name));

  update public.job_leases
  set
    owner_id = null,
    lease_expires_at = timestamptz 'epoch',
    updated_at = clock_timestamp()
  where job_name = p_job_name
    and owner_id = p_owner_id
  returning * into v_row;

  v_released := v_row.job_name is not null;
  if not v_released then
    select * into v_row from public.job_leases where job_name = p_job_name;
  end if;

  return jsonb_build_object(
    'released', v_released,
    'job_name', coalesce(v_row.job_name, p_job_name),
    'owner_id', v_row.owner_id,
    'lease_expires_at', v_row.lease_expires_at
  );
end;
$$;

revoke all on function public.try_acquire_job_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.renew_job_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_job_lease(text, text) from public, anon, authenticated;
grant execute on function public.try_acquire_job_lease(text, text, integer) to service_role;
grant execute on function public.renew_job_lease(text, text, integer) to service_role;
grant execute on function public.release_job_lease(text, text) to service_role;

notify pgrst, 'reload schema';
