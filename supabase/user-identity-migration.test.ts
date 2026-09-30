import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migration = readFileSync(new URL("./migrations/007_add_user_identity.sql", import.meta.url), "utf8");
const vocabulary = [
  ["software-engineering", "Software Engineering"],
  ["systems-infrastructure", "Systems / Infrastructure"],
  ["ai-machine-learning", "AI / Machine Learning"],
  ["data-analytics", "Data / Analytics"],
  ["cybersecurity", "Cybersecurity"],
  ["hardware-embedded", "Hardware / Embedded"],
  ["product", "Product"],
  ["fintech", "Fintech"],
  ["startups-entrepreneurship", "Startups / Entrepreneurship"],
  ["research", "Research"],
  ["consulting", "Consulting"],
] as const;

describe("user identity migration", () => {
  test("has one timestamped state per user/occurrence and creates profiles at signup", () => {
    const states = migration.match(/create table if not exists public\.user_occurrence_states \(([\s\S]*?)\n\);/)?.[1];
    expect(states).toContain("primary key (user_id, occurrence_id)");
    expect(states).toContain("references public.profiles(id) on delete cascade");
    expect(states).toContain("created_at timestamptz not null default now()");
    expect(states).toContain("updated_at timestamptz not null default now()");
    expect(migration).toMatch(/create trigger campus_radar_create_profile\s+after insert on auth\.users/);
    expect(migration).toContain("insert into public.profiles (id) values (new.id)");
    expect(migration).toContain("new.created_at := old.created_at");
    expect(migration).toContain("new.updated_at := now()");
  });

  test("each profile/state RLS policy restricts ownership, including UPDATE checks", () => {
    const policies = [...migration.matchAll(/create policy "[^"]+"\s+on public\.(profiles|user_occurrence_states)\s+for (select|insert|update|delete)\s+to authenticated\s+([\s\S]*?);/g)];
    expect(policies).toHaveLength(6);
    for (const [, table, operation, body] of policies) {
      const owner = `${table === "profiles" ? "id" : "user_id"} = (select auth.uid())`;
      if (operation !== "insert") expect(body).toContain(`using (${owner})`);
      if (operation === "insert" || operation === "update") expect(body).toContain(`with check (${owner})`);
    }
    for (const table of ["profiles", "user_occurrence_states"]) {
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`);
    }
  });

  test("stores occurrence preferences on event_occurrences and keeps event writes unchanged", () => {
    expect(migration).toContain("references public.event_occurrences(id) on delete cascade");
    expect(migration).not.toMatch(/references\s+public\.events\s*\(/i);
    expect(migration).toContain("check (status in ('interested', 'going', 'not_interested'))");
    expect(migration).not.toMatch(/^grant\b.*\bservice_role\b/im);
    for (const table of ["public.events", "public.event_occurrences", "public.event_occurrence_sources"]) {
      expect(migration).not.toContain(`on table ${table}`);
    }
  });

  test("enables RLS and seeds the controlled career-interest vocabulary", () => {
    for (const table of ["profiles", "career_interests", "profile_career_interests", "user_occurrence_states"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("id = (select auth.uid())");
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).toContain("grant select on table public.career_interests to anon, authenticated");
    expect(migration).not.toContain("grant insert on table public.profiles");
    const seeded = [...migration.matchAll(/\('([a-z0-9-]+)', '([^']+)', \d+\)/g)];
    expect(seeded.map((match) => [match[1], match[2]])).toEqual(vocabulary.map((entry) => [...entry]));
  });
});
