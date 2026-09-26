-- Plan against one MVCC snapshot; validate and commit the entire plan under
-- table locks. Concurrent collection or reconciliation invalidates stale plans.
create or replace function public.occurrence_reconciliation_snapshot()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.events e), '[]'::jsonb),
    'mappings', coalesce((select jsonb_agg(to_jsonb(m) order by m.event_id) from public.event_occurrence_sources m), '[]'::jsonb)
  );
$$;

create or replace function public.reconcile_occurrence_plan(p_snapshot jsonb, p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a jsonb;
  ids uuid[];
  target uuid;
  assigned integer := 0;
  joined integer := 0;
  created integer := 0;
begin
  -- Same lock order as the legacy assignment RPC. Events cannot be changed
  -- between validation and commit, including by collectors using REST upserts.
  perform pg_advisory_xact_lock(hashtext('campus-radar:event-occurrence-assignment'));
  lock table public.events in share mode;
  lock table public.event_occurrences, public.event_occurrence_sources in share row exclusive mode;
  if p_snapshot is distinct from public.occurrence_reconciliation_snapshot() then
    raise exception using errcode = 'PT409', message = 'Occurrence snapshot changed; replan required';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be an array';
  end if;
  for a in select value from jsonb_array_elements(p_assignments) loop
    select array_agg(value::uuid) into ids from jsonb_array_elements_text(a->'eventIds');
    if coalesce(cardinality(ids), 0) = 0 then raise exception 'Empty assignment'; end if;
    if exists (select 1 from public.event_occurrence_sources where event_id = any(ids)) then
      raise exception 'Plan attempts to reassign an established identity';
    end if;
    target := (a->>'occurrenceId')::uuid;
    perform public.assign_event_occurrence(ids, target);
    assigned := assigned + cardinality(ids);
    if target is null then created := created + 1; else joined := joined + 1; end if;
  end loop;
  if exists (select 1 from public.events e where not exists
    (select 1 from public.event_occurrence_sources m where m.event_id = e.id)) then
    raise exception 'Plan leaves unmapped events';
  end if;
  return jsonb_build_object('sourceEvents', jsonb_array_length(p_snapshot->'events'),
    'existingMappings', jsonb_array_length(p_snapshot->'mappings'),
    'assignedEvents', assigned, 'joinedOccurrences', joined, 'createdOccurrences', created);
end;
$$;

revoke all on function public.occurrence_reconciliation_snapshot() from public, anon, authenticated;
revoke all on function public.reconcile_occurrence_plan(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.occurrence_reconciliation_snapshot() to service_role;
grant execute on function public.reconcile_occurrence_plan(jsonb, jsonb) to service_role;
-- Prevent older workers from bypassing snapshot validation. The owner can
-- still call this helper from the security-definer transaction above.
revoke execute on function public.assign_event_occurrence(uuid[], uuid) from service_role;
notify pgrst, 'reload schema';
