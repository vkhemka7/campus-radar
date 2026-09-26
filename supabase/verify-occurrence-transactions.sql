-- Rollback-only integration checks. No fixture is committed or publicly visible.
begin;
do $$
declare
  original jsonb := public.occurrence_reconciliation_snapshot();
  current_snapshot jsonb;
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  chosen uuid;
  retried uuid;
  failed boolean := false;
  occurrence_count integer := (select count(*) from public.event_occurrences);
begin
  insert into public.events
  select (jsonb_populate_record(null::public.events, to_jsonb(e) || jsonb_build_object(
    'id', first_id, 'source', 'Checkpoint rollback test', 'external_id', first_id::text))).*
  from public.events e limit 1;
  insert into public.events
  select (jsonb_populate_record(null::public.events, to_jsonb(e) || jsonb_build_object(
    'id', second_id, 'source', 'Checkpoint rollback test', 'external_id', second_id::text))).*
  from public.events e where e.id = first_id;
  -- Shared source_url inserts above verify 004 without retaining test rows.
  begin
    perform public.reconcile_occurrence_plan(original, '[]');
  exception when sqlstate 'PT409' then failed := true;
  end;
  if not failed then raise exception 'Changed event snapshot was accepted'; end if;
  current_snapshot := public.occurrence_reconciliation_snapshot();
  failed := false;
  begin
    perform public.reconcile_occurrence_plan(current_snapshot, jsonb_build_array(
      jsonb_build_object('occurrenceId', null, 'eventIds', jsonb_build_array(first_id)),
      jsonb_build_object('occurrenceId', null, 'eventIds', jsonb_build_array('00000000-0000-0000-0000-000000000000'))));
  exception when raise_exception then
    if sqlerrm <> 'One or more event IDs do not exist' then raise; end if;
    failed := true;
  end;
  if not failed or current_snapshot <> public.occurrence_reconciliation_snapshot()
    or occurrence_count <> (select count(*) from public.event_occurrences) then
    raise exception 'Failed plan did not roll back completely';
  end if;
  chosen := public.assign_event_occurrence(array[first_id, second_id]);
  retried := public.assign_event_occurrence(array[first_id, second_id]);
  if chosen <> retried then raise exception 'Retry changed identity'; end if;
  failed := false;
  begin
    perform public.reconcile_occurrence_plan(current_snapshot, '[]');
  exception when sqlstate 'PT409' then failed := true;
  end;
  if not failed then raise exception 'Competing mapping snapshot was accepted'; end if;
  update public.events set title = title || ' richer representative',
    start_time = start_time + interval '1 day', end_time = end_time + interval '1 day'
    where id = second_id;
  if (select occurrence_id from public.event_occurrence_sources where event_id = second_id) <> chosen then
    raise exception 'Enrichment/reschedule changed identity';
  end if;
end;
$$;
rollback;
select 'PASS: shared URLs, stale event/mapping snapshots, full rollback, retry identity, enrichment/reschedule; all fixtures rolled back' as transaction_checks;
