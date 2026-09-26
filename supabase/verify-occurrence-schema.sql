-- Read-only checks for the existing Supabase SQL Editor workflow.
select conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.events'::regclass
order by conname;
-- 004 is effective when events_source_url_key is absent and
-- events_source_external_id_key remains UNIQUE (source, external_id).

select to_regclass('public.event_occurrences') as occurrences,
       to_regclass('public.event_occurrence_sources') as mappings,
       to_regprocedure('public.assign_event_occurrence(uuid[],uuid)') as assignment;
-- All three must exist for 005. Inspect deployed function rather than relying
-- only on a migration-history entry for manually applied migrations.
select pg_get_functiondef(to_regprocedure('public.assign_event_occurrence(uuid[],uuid)'));

-- After 006: all should be true. Function source is also inspected in the editor.
select has_function_privilege('service_role', 'public.reconcile_occurrence_plan(jsonb,jsonb)', 'EXECUTE') as service_can_reconcile,
  not has_function_privilege('anon', 'public.reconcile_occurrence_plan(jsonb,jsonb)', 'EXECUTE') as anon_cannot_reconcile,
  not has_function_privilege('authenticated', 'public.reconcile_occurrence_plan(jsonb,jsonb)', 'EXECUTE') as authenticated_cannot_reconcile,
  not has_function_privilege('service_role', 'public.assign_event_occurrence(uuid[],uuid)', 'EXECUTE') as legacy_bypass_disabled;
