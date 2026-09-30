import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileEventOccurrences, type ReconciliationResult } from "../event-occurrences";
import {
  WEBTOOLS_JOB_NAME,
  WEBTOOLS_LEASE_HEARTBEAT_MS,
  WEBTOOLS_LEASE_SECONDS,
  abbreviateOwnerId,
  createCollectorOwnerId,
  releaseJobLease,
  startJobLeaseHeartbeat,
  tryAcquireJobLease,
  type ReleaseJobLeaseResult,
  type SetTimer,
} from "../job-lease";
import { collectWebtools, type CollectionResult } from "./collect";
import { WEBTOOLS_CALENDARS, type WebtoolsCalendar } from "./constants";
import type { WebtoolsHtmlFetcher } from "./html-fetch";

export type CollectorRunStatus = "success" | "warning" | "failure" | "skipped_locked";

export type CollectorRunSummary = {
  status: CollectorRunStatus;
  started_at: string;
  finished_at: string;
  owner_id: string;
  invocation: string;
  lease: {
    job_name: string;
    acquired: boolean;
    released?: boolean;
    lease_expires_at?: string | null;
    release_error?: string;
  };
  collection?: {
    calendars_attempted: number;
    calendars_succeeded: number;
    calendars_failed: number;
    discovered: number;
    normalized: number;
    upserted: number;
    skipped: number;
    detail_failures: CollectionResult["detailFailures"];
    identity_conflicts: number;
    gate?: CollectionResult["gate"];
    time_validation?: CollectionResult["timeValidation"];
    database_error?: string;
  };
  occurrences?: ReconciliationResult;
  message?: string;
  error?: string;
  warnings: string[];
};

function collectionSummary(result: CollectionResult): NonNullable<CollectorRunSummary["collection"]> {
  const succeeded = result.calendars.filter(({ ok }) => ok).length;
  return {
    calendars_attempted: result.calendars.length,
    calendars_succeeded: succeeded,
    calendars_failed: result.calendars.length - succeeded,
    discovered: result.discovered,
    normalized: result.normalized,
    upserted: result.upserted,
    skipped: result.skipped,
    detail_failures: result.detailFailures,
    identity_conflicts: result.identityConflicts,
    gate: result.gate,
    time_validation: result.timeValidation,
    database_error: result.databaseError,
  };
}

function collectionFailed(result: CollectionResult): boolean {
  return !result.ok || Boolean(result.databaseError) || result.gate?.decision === "BLOCKED";
}

function detailWarning(result: CollectionResult): string | undefined {
  if (!result.detailFailures.length) return undefined;
  const ids = result.detailFailures.map((failure) => failure.eventId).join(", ");
  return `Isolated detail/schedule records failed closed (${result.detailFailures.length}): ${ids}. Valid candidates were still processed.`;
}

export async function runWebtoolsCollector(input: {
  supabase: SupabaseClient;
  calendars?: readonly WebtoolsCalendar[];
  ownerId?: string;
  now?: Date;
  fetcher?: WebtoolsHtmlFetcher;
  onProgress?: (message: string) => void;
  leaseSeconds?: number;
  heartbeatIntervalMs?: number;
  setTimer?: SetTimer;
  startedAt?: Date;
  clock?: () => Date;
}): Promise<CollectorRunSummary> {
  const clock = input.clock ?? (() => new Date());
  const started = input.startedAt ?? clock();
  const ownerId = input.ownerId ?? createCollectorOwnerId();
  const leaseSeconds = input.leaseSeconds ?? WEBTOOLS_LEASE_SECONDS;
  const warnings: string[] = [];
  const summary: CollectorRunSummary = {
    status: "failure",
    started_at: started.toISOString(),
    finished_at: started.toISOString(),
    owner_id: ownerId,
    invocation: abbreviateOwnerId(ownerId),
    lease: { job_name: WEBTOOLS_JOB_NAME, acquired: false },
    warnings,
  };

  let acquired = false;
  let primaryError: string | undefined;
  const finish = (status: CollectorRunStatus, error?: string, message?: string) => {
    summary.status = status;
    summary.finished_at = clock().toISOString();
    if (error) summary.error = error;
    if (message) summary.message = message;
    return summary;
  };

  try {
    const acquire = await tryAcquireJobLease(input.supabase, {
      jobName: WEBTOOLS_JOB_NAME,
      ownerId,
      leaseSeconds,
    });
    summary.lease.lease_expires_at = acquire.lease_expires_at;
    if (!acquire.acquired) {
      return finish(
        "skipped_locked",
        undefined,
        `Skipped collect_webtools because another owner holds an active lease (${acquire.owner_id ? abbreviateOwnerId(acquire.owner_id) : "unknown"}). No collection was performed.`,
      );
    }
    acquired = true;
    summary.lease.acquired = true;

    let leaseLost: Error | undefined;
    const heartbeat = startJobLeaseHeartbeat({
      supabase: input.supabase,
      jobName: WEBTOOLS_JOB_NAME,
      ownerId,
      leaseSeconds,
      intervalMs: input.heartbeatIntervalMs ?? WEBTOOLS_LEASE_HEARTBEAT_MS,
      setTimer: input.setTimer,
      onLost: (error) => {
        leaseLost = error;
      },
    });

    const assertStillOwns = () => {
      if (leaseLost) throw leaseLost;
    };

    try {
      const collection = await collectWebtools({
        supabase: input.supabase,
        calendars: input.calendars ?? WEBTOOLS_CALENDARS,
        fetcher: input.fetcher,
        now: input.now,
        onProgress: input.onProgress,
        assertStillOwns,
      });
      summary.collection = collectionSummary(collection);
      const isolated = detailWarning(collection);
      if (isolated) warnings.push(isolated);
      assertStillOwns();
      if (collectionFailed(collection)) {
        primaryError = collection.databaseError
          ?? (collection.gate?.blockers.length ? collection.gate.blockers.join("; ") : "Webtools collection failed.");
        return finish("failure", primaryError);
      }
      if (collection.upserted > 0) {
        summary.occurrences = await reconcileEventOccurrences(input.supabase, assertStillOwns);
        assertStillOwns();
      }
      return finish(collection.detailFailures.length ? "warning" : "success");
    } finally {
      await heartbeat.stop();
      if (summary.status !== "failure") assertStillOwns();
    }
  } catch (error) {
    primaryError = error instanceof Error ? error.message : String(error);
    return finish("failure", primaryError);
  } finally {
    if (acquired) {
      try {
        const released: ReleaseJobLeaseResult = await releaseJobLease(input.supabase, {
          jobName: WEBTOOLS_JOB_NAME,
          ownerId,
        });
        summary.lease.released = released.released;
        summary.lease.lease_expires_at = released.lease_expires_at;
        if (!released.released) {
          const message = "Failed to release collect_webtools lease; ownership may remain until expiry.";
          summary.lease.release_error = message;
          warnings.push(message);
          if (summary.status !== "failure") {
            summary.status = "failure";
            summary.error = message;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.lease.released = false;
        summary.lease.release_error = message;
        warnings.push(`Lease release failed; ownership may remain until expiry: ${message}`);
        if (summary.status !== "failure") {
          summary.status = "failure";
          summary.error = `Lease release failed: ${message}`;
        }
      }
    }
    summary.finished_at = clock().toISOString();
  }
}
