export const OCCURRENCE_STATUSES = ["interested", "going", "not_interested"] as const;

export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export type OccurrenceStateRequest = OccurrenceStatus | "unset";

export type OccurrenceStateChange =
  | { kind: "set"; status: OccurrenceStatus }
  | { kind: "clear" }
  | { kind: "none" };

export type OccurrenceStateSaveState =
  | { status: "success" }
  | { status: "error"; message: string };

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  interested: "Interested",
  going: "Going",
  not_interested: "Not Interested",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOccurrenceStatus(value: unknown): value is OccurrenceStatus {
  return typeof value === "string" && OCCURRENCE_STATUSES.some((status) => status === value);
}

/**
 * occurrence_id must be an event_occurrences.id. The shape check only rejects
 * junk early; the foreign key rejects a well-formed raw events.id.
 */
export function parseOccurrenceStateForm(
  formData: FormData,
): { ok: true; occurrenceId: string; request: OccurrenceStateRequest } | { ok: false; message: string } {
  const occurrenceId = formData.get("occurrence_id");
  const request = formData.get("status");
  if (typeof occurrenceId !== "string" || !UUID_PATTERN.test(occurrenceId)) {
    return { ok: false, message: "That event could not be updated." };
  }
  if (request !== "unset" && !isOccurrenceStatus(request)) {
    return { ok: false, message: "Choose Interested, Going, or Not Interested." };
  }
  return { ok: true, occurrenceId: occurrenceId.toLowerCase(), request };
}

/** The value a control submits: pressing the active state asks to clear it. */
export function nextOccurrenceRequest(
  current: OccurrenceStatus | null,
  pressed: OccurrenceStatus,
): OccurrenceStateRequest {
  return current === pressed ? "unset" : pressed;
}

export function planOccurrenceStateChange(
  current: OccurrenceStatus | null,
  request: OccurrenceStateRequest,
): OccurrenceStateChange {
  if (request === "unset") return current === null ? { kind: "none" } : { kind: "clear" };
  return current === request ? { kind: "none" } : { kind: "set", status: request };
}

export function readOccurrenceStates(rows: unknown): Map<string, OccurrenceStatus> | null {
  if (!Array.isArray(rows)) return null;
  const states = new Map<string, OccurrenceStatus>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const { occurrence_id: occurrenceId, status } = row as Record<string, unknown>;
    if (typeof occurrenceId !== "string" || !occurrenceId || !isOccurrenceStatus(status)) return null;
    if (states.has(occurrenceId)) return null;
    states.set(occurrenceId, status);
  }
  return states;
}
