import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

// Uses only rollback-failing plans: no synthetic rows or test mappings persist.
async function main() {
  const url = process.env.SUPABASE_URL!;
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
    console.log(`RPC HTTP ${response.status}: ${String(input).split("/").at(-1)}`);
    return response;
  };
  const service = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false }, global: { fetch: transport } });
  const anon = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false }, global: { fetch: transport } });
  console.log("Checking deployed RPC privileges and transactions...");
  const { data: before, error } = await service.rpc("occurrence_reconciliation_snapshot");
  assert.ifError(error);
  assert.ok(before.events.length);
  const anonymousRead = await anon.rpc("occurrence_reconciliation_snapshot");
  assert.equal(anonymousRead.error?.code, "42501");
  const anonymousWrite = await anon.rpc("reconcile_occurrence_plan", { p_snapshot: before, p_assignments: [] });
  assert.equal(anonymousWrite.error?.code, "42501");
  const legacy = await service.rpc("assign_event_occurrence", { p_event_ids: [before.events[0].id] });
  assert.equal(legacy.error?.code, "42501", "Legacy assignment bypass must be disabled");
  const stale = await service.rpc("reconcile_occurrence_plan", {
    p_snapshot: { ...before, events: [] }, p_assignments: [],
  });
  assert.equal(stale.error?.code, "PT409", "Stale plans must be rejected");
  const mapped = new Set(before.mappings.map((m: { event_id: string }) => m.event_id));
  const unmapped = before.events.find((e: { id: string }) => !mapped.has(e.id));
  if (unmapped) {
    const rollback = await service.rpc("reconcile_occurrence_plan", {
      p_snapshot: before,
      p_assignments: [
        { occurrenceId: null, eventIds: [unmapped.id] },
        { occurrenceId: null, eventIds: ["00000000-0000-0000-0000-000000000000"] },
      ],
    });
    assert.ok(rollback.error, "Invalid second assignment must roll back the first");
    console.log("PASS: failed second assignment rolls back the entire plan");
  } else {
    const reassignment = await service.rpc("reconcile_occurrence_plan", {
      p_snapshot: before, p_assignments: [{ occurrenceId: null, eventIds: [before.events[0].id] }],
    });
    assert.match(reassignment.error?.message ?? "", /established identity/);
    console.log("PASS: established identities cannot be reassigned");
  }
  const { data: after, error: afterError } = await service.rpc("occurrence_reconciliation_snapshot");
  assert.ifError(afterError);
  assert.deepEqual(after, before, "Rejected operations must leave events and mappings unchanged");
  console.log("PASS: anon denied, legacy bypass denied, stale plan rejected, snapshot unchanged");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
