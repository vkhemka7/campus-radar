import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migration = readFileSync(new URL("./migrations/009_add_digest_sends.sql", import.meta.url), "utf8");

describe("digest sends migration", () => {
  test("records one successful send per user and occurrence", () => {
    expect(migration).toContain("create table if not exists public.user_digest_sends");
    expect(migration).toContain("primary key (user_id, occurrence_id)");
    expect(migration).toContain("references public.profiles(id) on delete cascade");
    expect(migration).toContain("references public.event_occurrences(id) on delete cascade");
    expect(migration).not.toMatch(/references\s+public\.events\s*\(/i);
  });

  test("keeps delivery history off the public website roles", () => {
    expect(migration).toContain("alter table public.user_digest_sends enable row level security");
    expect(migration).toContain("revoke all on table public.user_digest_sends from public, anon, authenticated, service_role");
    expect(migration).toContain("grant select, insert on table public.user_digest_sends to service_role");
    expect(migration).not.toMatch(/grant\b.*\bon table public\.user_digest_sends to (public|anon|authenticated)/);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toContain("grant select on table public.profile_career_interests to service_role");
    expect(migration).toContain("grant select on table public.user_occurrence_states to service_role");
  });
});
