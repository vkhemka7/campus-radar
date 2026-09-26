-- Stable logical event identities. Raw public.events rows remain unchanged and
-- retain source provenance; each source row maps to exactly one occurrence.

create table if not exists public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.event_occurrence_sources (
  occurrence_id uuid not null references public.event_occurrences(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  primary key (occurrence_id, event_id),
  constraint event_occurrence_sources_event_id_key unique (event_id)
);

alter table public.event_occurrences enable row level security;
alter table public.event_occurrence_sources enable row level security;

revoke all on table public.event_occurrences from anon, authenticated;
revoke all on table public.event_occurrence_sources from anon, authenticated;
grant select on table public.event_occurrences to anon, authenticated;
grant select on table public.event_occurrence_sources to anon, authenticated;
grant select on table public.event_occurrences to service_role;
grant select on table public.event_occurrence_sources to service_role;

drop policy if exists "Anyone can read event occurrences" on public.event_occurrences;
create policy "Anyone can read event occurrences"
  on public.event_occurrences for select to anon, authenticated using (true);

drop policy if exists "Anyone can read event occurrence sources" on public.event_occurrence_sources;
create policy "Anyone can read event occurrence sources"
  on public.event_occurrence_sources for select to anon, authenticated using (true);

-- Atomically attach one or more previously unmapped raw rows. Existing
-- mappings win, making retries safe. The service role is the only caller.
create or replace function public.assign_event_occurrence(
  p_event_ids uuid[],
  p_occurrence_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_ids uuid[];
  v_existing_count integer;
  v_existing_id uuid;
  v_occurrence_id uuid;
begin
  select array_agg(distinct input_event_id order by input_event_id)
  into v_event_ids
  from unnest(p_event_ids) as input(input_event_id);

  if coalesce(cardinality(v_event_ids), 0) = 0 then
    raise exception 'At least one event ID is required';
  end if;

  -- Serialize occurrence assignment without locking or changing raw events.
  perform pg_advisory_xact_lock(hashtext('campus-radar:event-occurrence-assignment'));

  if (select count(*) from public.events where id = any(v_event_ids)) <> cardinality(v_event_ids) then
    raise exception 'One or more event IDs do not exist';
  end if;

  select count(distinct occurrence_id), min(occurrence_id::text)::uuid
  into v_existing_count, v_existing_id
  from public.event_occurrence_sources
  where event_id = any(v_event_ids);

  if v_existing_count > 1 then
    raise exception 'Event IDs already belong to different occurrences';
  end if;

  if v_existing_count = 1 then
    if p_occurrence_id is not null and p_occurrence_id <> v_existing_id then
      raise exception 'Existing occurrence mapping conflicts with requested occurrence';
    end if;
    v_occurrence_id := v_existing_id;
  elsif p_occurrence_id is not null then
    if not exists (select 1 from public.event_occurrences where id = p_occurrence_id) then
      raise exception 'Requested occurrence does not exist';
    end if;
    v_occurrence_id := p_occurrence_id;
  else
    insert into public.event_occurrences default values returning id into v_occurrence_id;
  end if;

  insert into public.event_occurrence_sources (occurrence_id, event_id)
  select v_occurrence_id, input_event_id from unnest(v_event_ids) as input(input_event_id)
  on conflict (event_id) do nothing;

  if exists (
    select 1 from public.event_occurrence_sources
    where event_id = any(v_event_ids) and occurrence_id <> v_occurrence_id
  ) then
    raise exception 'Concurrent occurrence assignment conflict';
  end if;

  return v_occurrence_id;
end;
$$;

revoke all on function public.assign_event_occurrence(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.assign_event_occurrence(uuid[], uuid) to service_role;
