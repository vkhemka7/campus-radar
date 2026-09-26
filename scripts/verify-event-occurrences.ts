import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { reconcileEventOccurrences } from "../lib/event-occurrences";
import { getEvents } from "../lib/get-events";

// Read-only by default. --reconcile performs two real reconciliation passes.
// Each reconciliation is atomic; final read-only coverage checks assume no active collection.
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--reconcile")) {
    throw new Error("Usage: verify-event-occurrences.ts [--reconcile]");
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase configuration.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function read(table: string, columns: string) {
    const rows: Record<string, string>[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await client.from(table).select(columns)
        .order(table === "event_occurrence_sources" ? "event_id" : "id").range(offset, offset + 99);
      if (error) throw new Error(`${table}: ${error.code}: ${error.message}`);
      const batch = data as unknown as Record<string, string>[];
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
  }
  async function snapshot() {
    const events = await read("events", "id");
    console.log(JSON.stringify({ rawEvents: events.length }));
    const occurrences = await read("event_occurrences", "id");
    const mappings = await read("event_occurrence_sources", "event_id,occurrence_id");
    const eventIds = new Set(events.map(({ id }) => id));
    const occurrenceIds = new Set(occurrences.map(({ id }) => id));
    const mapped = new Set(mappings.map(({ event_id }) => event_id));
    const unmapped = events.filter(({ id }) => !mapped.has(id)).length;
    const invalid = mappings.filter(({ event_id, occurrence_id }) =>
      !eventIds.has(event_id) || !occurrenceIds.has(occurrence_id)).length;
    const duplicateMappings = mappings.length - mapped.size;
    const identityDigest = createHash("sha256").update(JSON.stringify(mappings)).digest("hex");
    const orphanOccurrences = occurrences.filter(({ id }) => !mappings.some(({ occurrence_id }) => occurrence_id === id)).length;
    console.log(JSON.stringify({ identityDigest, orphanOccurrences, occurrences: occurrences.length, mappings: mappings.length,
      unmapped, invalid, duplicateMappings }));
    return { events, occurrences, mappings, unmapped, invalid, duplicateMappings };
  }
  const before = await snapshot();
  let after = before;
  if (args[0] === "--reconcile") {
    console.log(JSON.stringify({ firstPass: await reconcileEventOccurrences(client) }));
    const first = await snapshot();
    const secondPass = await reconcileEventOccurrences(client);
    console.log(JSON.stringify({ secondPass }));
    after = await snapshot();
    if (secondPass.assignedEvents !== 0 || JSON.stringify(first) !== JSON.stringify(after)) {
      throw new Error("Second reconciliation changed the snapshot; idempotence not verified.");
    }
    if (JSON.stringify(before.events) !== JSON.stringify(after.events)) throw new Error("Raw event IDs changed during verification.");
    console.log("PASS: two-pass idempotence, identical occurrence/mapping snapshots, unchanged raw IDs");
    const current = new Map(after.mappings.map(({ event_id, occurrence_id }) => [event_id, occurrence_id]));
    if (before.mappings.some(({ event_id, occurrence_id }) => current.get(event_id) !== occurrence_id)) {
      throw new Error("An established identity changed.");
    }
  }
  console.log(`PASS: preserved ${before.mappings.length} established event-to-occurrence IDs`);
  if (after.unmapped || after.invalid || after.duplicateMappings) throw new Error("Occurrence coverage failed.");
  for (const view of ["career", "all"] as const) {
    const result = await getEvents({ view });
    if (!result.ok) throw new Error(`Publishable-key homepage query failed for ${view}.`);
    console.log(JSON.stringify({ view, visibleOccurrences: result.events.length }));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
