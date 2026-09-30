import { beforeEach, describe, expect, test, vi } from "vitest";
import { runWebtoolsCollector } from "./collect-run";
import { WEBTOOLS_CALENDARS } from "./constants";

const collectMock = vi.fn();
const reconcileMock = vi.fn();
const acquireMock = vi.fn();
const releaseMock = vi.fn();
const startHeartbeatMock = vi.fn();

vi.mock("./collect", () => ({ collectWebtools: (...args: unknown[]) => collectMock(...args) }));
vi.mock("../event-occurrences", () => ({ reconcileEventOccurrences: (...args: unknown[]) => reconcileMock(...args) }));
vi.mock("../job-lease", async () => {
  const actual = await vi.importActual<typeof import("../job-lease")>("../job-lease");
  return {
    ...actual,
    tryAcquireJobLease: (...args: unknown[]) => acquireMock(...args),
    releaseJobLease: (...args: unknown[]) => releaseMock(...args),
    startJobLeaseHeartbeat: (...args: unknown[]) => startHeartbeatMock(...args),
  };
});

const supabase = { rpc: vi.fn() };
const collection = {
  ok: true,
  calendars: WEBTOOLS_CALENDARS.map((calendar) => ({ id: calendar.id, ok: true })),
  discovered: 2,
  normalized: 2,
  detailFailures: [],
  upserted: 2,
  skipped: 0,
  identityConflicts: 0,
  gate: { decision: "READY_FOR_CUTOVER", blockers: [] },
};

function acquire(owned = true) {
  acquireMock.mockResolvedValue({
    acquired: owned,
    job_name: "collect_webtools",
    owner_id: owned ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
    lease_expires_at: owned ? "2026-09-28T00:10:00Z" : "2026-09-28T00:09:00Z",
  });
}

describe("leased webtools collector run", () => {
  beforeEach(() => {
    collectMock.mockReset().mockResolvedValue(collection);
    reconcileMock.mockReset().mockResolvedValue({
      sourceEvents: 2, existingMappings: 0, assignedEvents: 2, joinedOccurrences: 0, createdOccurrences: 2,
    });
    acquireMock.mockReset();
    releaseMock.mockReset().mockResolvedValue({
      released: true, job_name: "collect_webtools", owner_id: null, lease_expires_at: "1970-01-01T00:00:00Z",
    });
    startHeartbeatMock.mockReset().mockReturnValue({ stop: vi.fn().mockResolvedValue(undefined) });
    acquire();
  });

  test("skips collection when another owner holds the lease", async () => {
    acquire(false);
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary).toMatchObject({
      status: "skipped_locked",
      lease: { acquired: false, job_name: "collect_webtools" },
      invocation: "11111111",
    });
    expect(summary.message).toMatch(/another owner holds an active lease/i);
    expect(collectMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
    expect(startHeartbeatMock).not.toHaveBeenCalled();
  });

  test("acquires, heartbeats, writes, reconciles, and releases on success", async () => {
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
      heartbeatIntervalMs: 20,
    });
    expect(summary.status).toBe("success");
    expect(summary.lease).toMatchObject({ acquired: true, released: true });
    expect(collectMock.mock.invocationCallOrder[0]).toBeLessThan(reconcileMock.mock.invocationCallOrder[0]);
    expect(reconcileMock).toHaveBeenCalledWith(supabase, expect.any(Function));
    expect(startHeartbeatMock).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "11111111-1111-4111-8111-111111111111",
      intervalMs: 20,
      leaseSeconds: 600,
    }));
    expect(releaseMock).toHaveBeenCalledWith(supabase, {
      jobName: "collect_webtools",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary.collection).toMatchObject({
      calendars_attempted: 7, calendars_succeeded: 7, calendars_failed: 0,
      discovered: 2, upserted: 2,
    });
  });

  test("treats isolated detail failures as warning after successful writes and reconciliation", async () => {
    collectMock.mockResolvedValue({
      ...collection,
      ok: true,
      normalized: 1,
      upserted: 1,
      skipped: 1,
      detailFailures: [{ eventId: "33553793", calendarId: "1551", stage: "schedule", reason: "unparsed-date" }],
    });
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary.status).toBe("warning");
    expect(summary.warnings[0]).toMatch(/33553793/);
    expect(reconcileMock).toHaveBeenCalled();
    expect(summary.error).toBeUndefined();
  });

  test("does not reconcile after a blocked collection", async () => {
    collectMock.mockResolvedValue({
      ...collection,
      ok: false,
      upserted: 0,
      gate: { decision: "BLOCKED", blockers: ["a calendar list failed"] },
    });
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary.status).toBe("failure");
    expect(summary.error).toMatch(/calendar list failed/);
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  test("fails closed on heartbeat loss and still attempts release", async () => {
    const { JobLeaseLostError } = await import("../job-lease");
    collectMock.mockImplementation(async ({ assertStillOwns }: { assertStillOwns?: () => void }) => {
      startHeartbeatMock.mock.calls[0][0].onLost(new JobLeaseLostError("taken"));
      assertStillOwns?.();
      return collection;
    });
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary.status).toBe("failure");
    expect(summary.error).toMatch(/taken/);
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(startHeartbeatMock.mock.results[0].value.stop).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  test("releases after a thrown collection failure and keeps that error", async () => {
    collectMock.mockRejectedValue(new Error("upsert exploded"));
    releaseMock.mockRejectedValue(new Error("release denied"));
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary.status).toBe("failure");
    expect(summary.error).toBe("upsert exploded");
    expect(summary.lease.release_error).toBe("release denied");
    expect(summary.warnings.some((warning) => warning.includes("ownership may remain until expiry"))).toBe(true);
  });

  test("does not reconcile when nothing was upserted", async () => {
    collectMock.mockResolvedValue({ ...collection, upserted: 0, discovered: 0, normalized: 0 });
    const summary = await runWebtoolsCollector({
      supabase: supabase as never,
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(summary.status).toBe("success");
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  test.each([false, "transport"])("fails a clean run when release fails: %s", async (failure) => {
    if (failure === "transport") releaseMock.mockRejectedValue(new Error("release denied"));
    else releaseMock.mockResolvedValue({ released: false });
    const summary = await runWebtoolsCollector({ supabase: supabase as never });
    expect(summary.status).toBe("failure");
    expect(summary.lease.released).toBe(false);
    expect(summary.lease.release_error).toBeTruthy();
    expect(summary.error).toMatch(/release/i);
  });

  test("fails when an in-flight heartbeat reports loss during shutdown", async () => {
    startHeartbeatMock.mockImplementation(({ onLost }) => ({
      stop: async () => { onLost(new Error("late heartbeat failure")); },
    }));
    const summary = await runWebtoolsCollector({ supabase: supabase as never });
    expect(summary.status).toBe("failure");
    expect(summary.error).toBe("late heartbeat failure");
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
