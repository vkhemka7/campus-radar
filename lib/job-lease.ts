import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const WEBTOOLS_JOB_NAME = "collect_webtools";
export const WEBTOOLS_LEASE_SECONDS = 600;
export const WEBTOOLS_LEASE_HEARTBEAT_MS = 120_000;

export type JobLeaseState = {
  job_name: string;
  owner_id: string | null;
  lease_expires_at: string | null;
};

export type AcquireJobLeaseResult = JobLeaseState & { acquired: boolean };
export type RenewJobLeaseResult = JobLeaseState & { renewed: boolean };
export type ReleaseJobLeaseResult = JobLeaseState & { released: boolean };

export class JobLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobLeaseLostError";
  }
}

export function createCollectorOwnerId(): string {
  return randomUUID();
}

export function abbreviateOwnerId(ownerId: string): string {
  return ownerId.slice(0, 8);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Job lease RPC returned an invalid ${field}.`);
  }
  return value;
}

function ownerField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Job lease RPC returned an invalid owner_id.");
  }
  return value;
}

function expiresField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Job lease RPC returned an invalid lease_expires_at.");
  }
  return value;
}

function asRecord(data: unknown, rpc: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${rpc} returned an invalid payload.`);
  }
  return data as Record<string, unknown>;
}

export async function tryAcquireJobLease(
  supabase: SupabaseClient,
  input: { jobName: string; ownerId: string; leaseSeconds: number },
): Promise<AcquireJobLeaseResult> {
  const { data, error } = await supabase.rpc("try_acquire_job_lease", {
    p_job_name: input.jobName,
    p_owner_id: input.ownerId,
    p_lease_seconds: input.leaseSeconds,
  });
  if (error) throw new Error(`try_acquire_job_lease failed: ${error.message}`);
  const row = asRecord(data, "try_acquire_job_lease");
  if (typeof row.acquired !== "boolean") {
    throw new Error("try_acquire_job_lease returned an invalid acquired flag.");
  }
  return {
    acquired: row.acquired,
    job_name: requiredText(row.job_name, "job_name"),
    owner_id: ownerField(row.owner_id),
    lease_expires_at: expiresField(row.lease_expires_at),
  };
}

export async function renewJobLease(
  supabase: SupabaseClient,
  input: { jobName: string; ownerId: string; leaseSeconds: number },
): Promise<RenewJobLeaseResult> {
  const { data, error } = await supabase.rpc("renew_job_lease", {
    p_job_name: input.jobName,
    p_owner_id: input.ownerId,
    p_lease_seconds: input.leaseSeconds,
  });
  if (error) throw new Error(`renew_job_lease failed: ${error.message}`);
  const row = asRecord(data, "renew_job_lease");
  if (typeof row.renewed !== "boolean") {
    throw new Error("renew_job_lease returned an invalid renewed flag.");
  }
  return {
    renewed: row.renewed,
    job_name: requiredText(row.job_name, "job_name"),
    owner_id: ownerField(row.owner_id),
    lease_expires_at: expiresField(row.lease_expires_at),
  };
}

export async function releaseJobLease(
  supabase: SupabaseClient,
  input: { jobName: string; ownerId: string },
): Promise<ReleaseJobLeaseResult> {
  const { data, error } = await supabase.rpc("release_job_lease", {
    p_job_name: input.jobName,
    p_owner_id: input.ownerId,
  });
  if (error) throw new Error(`release_job_lease failed: ${error.message}`);
  const row = asRecord(data, "release_job_lease");
  if (typeof row.released !== "boolean") {
    throw new Error("release_job_lease returned an invalid released flag.");
  }
  return {
    released: row.released,
    job_name: requiredText(row.job_name, "job_name"),
    owner_id: ownerField(row.owner_id),
    lease_expires_at: expiresField(row.lease_expires_at),
  };
}

export type CancelTimer = () => void;
export type SetTimer = (callback: () => void, ms: number) => CancelTimer;

const nodeSetTimer: SetTimer = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

export function startJobLeaseHeartbeat(input: {
  supabase: SupabaseClient;
  jobName: string;
  ownerId: string;
  leaseSeconds: number;
  intervalMs?: number;
  setTimer?: SetTimer;
  onLost: (error: Error) => void;
}): { stop: () => Promise<void> } {
  const intervalMs = input.intervalMs ?? WEBTOOLS_LEASE_HEARTBEAT_MS;
  const setTimer = input.setTimer ?? nodeSetTimer;
  let stopped = false;
  let stopping = false;
  let cancel: CancelTimer | undefined;
  let inFlight: Promise<void> | undefined;
  let reportedLoss = false;

  const reportLost = (error: Error) => {
    if (reportedLoss || stopped) return;
    reportedLoss = true;
    input.onLost(error);
  };

  const tick = () => {
    if (stopped || stopping) return;
    inFlight = (async () => {
      try {
        const result = await renewJobLease(input.supabase, {
          jobName: input.jobName,
          ownerId: input.ownerId,
          leaseSeconds: input.leaseSeconds,
        });
        if (stopped) return;
        if (!result.renewed) {
          reportLost(new JobLeaseLostError(
            `Lost collect_webtools lease; renew was rejected for owner ${abbreviateOwnerId(input.ownerId)}.`,
          ));
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportLost(error instanceof JobLeaseLostError ? error : new JobLeaseLostError(message));
        return;
      }
      if (!stopped && !stopping && !reportedLoss) cancel = setTimer(tick, intervalMs);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      reportLost(error instanceof JobLeaseLostError ? error : new JobLeaseLostError(message));
    });
  };

  cancel = setTimer(tick, intervalMs);

  return {
    async stop() {
      stopping = true;
      cancel?.();
      if (inFlight) await inFlight;
      stopped = true;
    },
  };
}
