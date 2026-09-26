-- Preserve separate source rows when multiple feeds link to the same event page.
-- Source identity remains protected by events_source_external_id_key.

alter table public.events
  drop constraint if exists events_source_url_key;
