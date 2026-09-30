import { describe, expect, test, vi } from "vitest";
import {
  WEBTOOLS_JOB_NAME,
  WEBTOOLS_LEASE_HEARTBEAT_MS,
  WEBTOOLS_LEASE_SECONDS,
  abbreviateOwnerId,
  createCollectorOwnerId,
  releaseJobLease,
  renewJobLease,
  startJobLeaseHeartbeat,
  tryAcquireJobLease,
} from "./job-lease";

function rpcClient(impl: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message: string } | null }>) {
  return { rpc: vi.fn(impl) };
}

describe("job lease client", () => {
  test("mints opaque UUID owners matching the RPC format", () => {
    const owner = createCollectorOwnerId();
    expect(owner).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(owner).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(abbreviateOwnerId(owner)).toHaveLength(8);
    expect(createCollectorOwnerId()).not.toBe(owner);
  });

  test("uses the seeded job name and documented durations", () => {
    expect(WEBTOOLS_JOB_NAME).toBe("collect_webtools");
    expect(WEBTOOLS_LEASE_SECONDS).toBe(600);
    expect(WEBTOOLS_LEASE_HEARTBEAT_MS).toBe(120_000);
  });

  test("maps acquire, renew, and release RPC payloads", async () => {
    const supabase = rpcClient(async (name, args) => {
      expect(args.p_job_name).toBe("collect_webtools");
      expect(args.p_owner_id).toBe("owner-aaaaaaaa");
      if (name === "try_acquire_job_lease") {
        expect(args.p_lease_seconds).toBe(600);
        return { data: { acquired: true, job_name: name, owner_id: args.p_owner_id, lease_expires_at: "2026-09-28T00:10:00Z" } };
      }
      if (name === "renew_job_lease") {
        return { data: { renewed: true, job_name: "collect_webtools", owner_id: args.p_owner_id, lease_expires_at: "2026-09-28T00:12:00Z" } };
      }
      return { data: { released: true, job_name: "collect_webtools", owner_id: null, lease_expires_at: "1970-01-01T00:00:00Z" } };
    });
    expect(await tryAcquireJobLease(supabase as never, {
      jobName: WEBTOOLS_JOB_NAME, ownerId: "owner-aaaaaaaa", leaseSeconds: WEBTOOLS_LEASE_SECONDS,
    })).toMatchObject({ acquired: true, owner_id: "owner-aaaaaaaa" });
    expect(await renewJobLease(supabase as never, {
      jobName: WEBTOOLS_JOB_NAME, ownerId: "owner-aaaaaaaa", leaseSeconds: WEBTOOLS_LEASE_SECONDS,
    })).toMatchObject({ renewed: true });
    expect(await releaseJobLease(supabase as never, {
      jobName: WEBTOOLS_JOB_NAME, ownerId: "owner-aaaaaaaa",
    })).toMatchObject({ released: true, owner_id: null });
  });

  test("treats RPC transport errors as failures", async () => {
    const supabase = rpcClient(async () => ({ error: { message: "denied" } }));
    await expect(tryAcquireJobLease(supabase as never, {
      jobName: WEBTOOLS_JOB_NAME, ownerId: "owner-aaaaaaaa", leaseSeconds: 600,
    })).rejects.toThrow("try_acquire_job_lease failed");
  });

  test("renews on the injectable timer and stops without leaking callbacks", async () => {
    const callbacks: Array<() => void> = [];
    const setTimer = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return () => undefined;
    });
    const supabase = rpcClient(async (name) => {
      expect(name).toBe("renew_job_lease");
      return { data: { renewed: true, job_name: "collect_webtools", owner_id: "owner-aaaaaaaa", lease_expires_at: "t" } };
    });
    const lost = vi.fn();
    const heartbeat = startJobLeaseHeartbeat({
      supabase: supabase as never,
      jobName: WEBTOOLS_JOB_NAME,
      ownerId: "owner-aaaaaaaa",
      leaseSeconds: 600,
      intervalMs: 15,
      setTimer,
      onLost: lost,
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    callbacks[0]();
    await vi.waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(lost).not.toHaveBeenCalled();
    await heartbeat.stop();
    const scheduled = callbacks.length;
    callbacks.at(-1)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(scheduled);
  });

  test("fails closed when renew is rejected", async () => {
    let fire: () => void = () => undefined;
    const supabase = rpcClient(async () => ({
      data: { renewed: false, job_name: "collect_webtools", owner_id: "other-owner", lease_expires_at: "t" },
    }));
    const lost = vi.fn();
    const heartbeat = startJobLeaseHeartbeat({
      supabase: supabase as never,
      jobName: WEBTOOLS_JOB_NAME,
      ownerId: "owner-aaaaaaaa",
      leaseSeconds: 600,
      intervalMs: 15,
      setTimer: (callback) => {
        fire = callback;
        return () => undefined;
      },
      onLost: lost,
    });
    fire();
    await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
    expect(lost.mock.calls[0][0].name).toBe("JobLeaseLostError");
    await heartbeat.stop();
  });

  test("reports an in-flight renewal failure while stopping", async () => {
    let fire = () => {};
    let rejectRenew!: (error: Error) => void;
    const supabase = rpcClient(() => new Promise((_, reject) => { rejectRenew = reject; }));
    const lost = vi.fn();
    const heartbeat = startJobLeaseHeartbeat({
      supabase: supabase as never, jobName: WEBTOOLS_JOB_NAME,
      ownerId: "owner-aaaaaaaa", leaseSeconds: 600, onLost: lost,
      setTimer: (callback) => { fire = callback; return () => {}; },
    });
    fire();
    const stopping = heartbeat.stop();
    rejectRenew(new Error("renew transport failed"));
    await stopping;
    expect(lost).toHaveBeenCalledOnce();
    expect(lost.mock.calls[0][0].message).toContain("renew transport failed");
  });
});
