-- The CLI collector authenticates with a secret key, which maps to the
-- Postgres role `service_role`. That role bypasses Row Level Security, but
-- Postgres still checks table GRANTs first.
--
-- Migration 001 granted SELECT to anon and authenticated only. On current
-- Supabase projects, new tables are not auto-granted to service_role, so the
-- collector could read-policy-bypass and still get "permission denied for
-- table events" on INSERT/UPDATE.
--
-- Do not grant write privileges to anon or authenticated. The public website
-- stays SELECT-only.

grant select, insert, update on table public.events to service_role;
