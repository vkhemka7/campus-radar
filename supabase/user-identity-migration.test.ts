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
