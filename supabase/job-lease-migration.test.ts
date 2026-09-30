import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migration = readFileSync(new URL("./migrations/008_add_job_leases.sql", import.meta.url), "utf8");

describe("job lease migration", () => {
  test("creates one lease row per job and seeds collect_webtools", () => {
    expect(migration).toContain("create table if not exists public.job_leases");
    expect(migration).toContain("job_name text primary key");
    expect(migration).toContain("values ('collect_webtools', null, timestamptz 'epoch')");
    expect(migration).not.toMatch(/create table if not exists public\.job_runs/);
    expect(migration).not.toMatch(/create table if not exists public\.job_history/);
  });

  test("decides expiry with server clock_timestamp and a single UPDATE acquire", () => {
    expect(migration).toContain("clock_timestamp()");
    expect(migration).not.toMatch(/p_now|p_expires|client_time|local clock/i);
    expect(migration).toMatch(/update public\.job_leases[\s\S]*lease_expires_at <= clock_timestamp\(\)/);
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('campus-radar:job-lease:' || p_job_name))");
    expect(migration).not.toContain("pg_try_advisory_lock");
    expect(migration).not.toContain("pg_advisory_unlock");
  });

  test("restricts mutations to security-definer service_role RPCs", () => {
    expect(migration).toContain("alter table public.job_leases enable row level security");
    expect(migration).toContain("revoke all on table public.job_leases from public, anon, authenticated, service_role");
    expect(migration).not.toMatch(/grant\b.*\bon table public\.job_leases\b/);
    for (const fn of ["try_acquire_job_lease", "renew_job_lease", "release_job_lease"]) {
      expect(migration).toContain(`create or replace function public.${fn}`);
      expect(migration).toContain("security definer");
    }
    expect(migration).toContain("grant execute on function public.try_acquire_job_lease(text, text, integer) to service_role");
    expect(migration).toContain("grant execute on function public.renew_job_lease(text, text, integer) to service_role");
    expect(migration).toContain("grant execute on function public.release_job_lease(text, text) to service_role");
    expect(migration).toContain("revoke all on function public.try_acquire_job_lease(text, text, integer) from public, anon, authenticated");
    expect(migration).toContain("revoke all on function public.renew_job_lease(text, text, integer) from public, anon, authenticated");
    expect(migration).toContain("revoke all on function public.release_job_lease(text, text) from public, anon, authenticated");
  });

  test("documents 600s leases and 120s heartbeats for collector integration", () => {
    expect(migration).toContain("initial lease 600 seconds");
    expect(migration).toContain("heartbeat / renew every 120 seconds");
    expect(migration).toContain("Privileged collectors call these RPCs");
    expect(migration).toContain("Lease duration must be between 60 and 1800 seconds");
  });
});

describe("job lease verification scripts", () => {
  const privileges = readFileSync(new URL("./verify-job-leases.sql", import.meta.url), "utf8");
  const transactions = readFileSync(new URL("./verify-job-lease-transactions.sql", import.meta.url), "utf8");

  test("privilege script denies anon and authenticated and uses rollback-free selects", () => {
    expect(privileges).toContain("anon_cannot_acquire");
    expect(privileges).toContain("user_cannot_acquire");
    expect(privileges).toContain("service_can_acquire");
    expect(privileges).not.toMatch(/\b(insert|update|delete)\s+into\s+public\.job_leases/i);
  });

  test("transaction script covers acquire, peer deny, renew, release, and expired takeover then rolls back", () => {
    expect(transactions).toMatch(/begin;/i);
    expect(transactions).toMatch(/rollback;/i);
    expect(transactions).toContain("A should acquire a free lease");
    expect(transactions).toContain("B must not acquire A''s active lease");
    expect(transactions).toContain("A should renew its lease");
    expect(transactions).toContain("B must not renew A''s lease");
    expect(transactions).toContain("B must not release A''s lease");
    expect(transactions).toContain("A should release its lease");
    expect(transactions).toContain("B should acquire after A releases");
    expect(transactions).toContain("A should take over B''s expired lease");
    expect(transactions).toContain("Two owners cannot both");
  });
});
