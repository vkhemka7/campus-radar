import { describe, expect, test } from "vitest";
import {
  isOccurrenceStatus,
  nextOccurrenceRequest,
  parseOccurrenceStateForm,
  planOccurrenceStateChange,
  readOccurrenceStates,
} from "@/lib/occurrence-states";

const occurrenceId = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

function form(fields: Record<string, string | Blob>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

describe("occurrence state parsing", () => {
  test("accepts only the three stored statuses", () => {
    expect(["interested", "going", "not_interested"].every(isOccurrenceStatus)).toBe(true);
    for (const value of ["unset", "Interested", "already_going", "", null, 1]) {
      expect(isOccurrenceStatus(value)).toBe(false);
    }
  });

  test("parses a status or an explicit unset for a stable occurrence id", () => {
    expect(parseOccurrenceStateForm(form({ occurrence_id: occurrenceId, status: "going" }))).toEqual({
      ok: true,
      occurrenceId,
      request: "going",
    });
    expect(parseOccurrenceStateForm(form({ occurrence_id: occurrenceId.toUpperCase(), status: "unset" }))).toEqual({
      ok: true,
      occurrenceId,
      request: "unset",
    });
  });

  test("rejects invalid statuses and ids, and ignores any submitted user id", () => {
    expect(parseOccurrenceStateForm(form({ occurrence_id: occurrenceId, status: "maybe" }))).toEqual({
      ok: false,
      message: "Choose Interested, Going, or Not Interested.",
    });
    expect(parseOccurrenceStateForm(form({ occurrence_id: occurrenceId })).ok).toBe(false);
    for (const id of ["", "occurrence-1", `${occurrenceId}x`, "' or 1=1 --"]) {
      expect(parseOccurrenceStateForm(form({ occurrence_id: id, status: "going" }))).toEqual({
        ok: false,
        message: "That event could not be updated.",
      });
    }
    expect(parseOccurrenceStateForm(form({ occurrence_id: new Blob([occurrenceId]), status: "going" })).ok).toBe(false);

    const parsed = parseOccurrenceStateForm(form({ occurrence_id: occurrenceId, status: "going", user_id: "other" }));
    expect(parsed).not.toHaveProperty("userId");
  });
});

describe("occurrence state transitions", () => {
  test("pressing the active state requests unset; any other button requests that state", () => {
    expect(nextOccurrenceRequest(null, "interested")).toBe("interested");
    expect(nextOccurrenceRequest("interested", "going")).toBe("going");
    expect(nextOccurrenceRequest("going", "going")).toBe("unset");
  });

  test("sets, replaces, clears, and skips no-op requests", () => {
    expect(planOccurrenceStateChange(null, "going")).toEqual({ kind: "set", status: "going" });
    expect(planOccurrenceStateChange("interested", "not_interested")).toEqual({ kind: "set", status: "not_interested" });
    expect(planOccurrenceStateChange("going", "unset")).toEqual({ kind: "clear" });
    expect(planOccurrenceStateChange(null, "unset")).toEqual({ kind: "none" });
    expect(planOccurrenceStateChange("going", "going")).toEqual({ kind: "none" });
  });

  test("reads saved rows keyed by occurrence id and rejects malformed rows", () => {
    expect(readOccurrenceStates([{ occurrence_id: occurrenceId, status: "going" }])).toEqual(
      new Map([[occurrenceId, "going"]]),
    );
    expect(readOccurrenceStates([])).toEqual(new Map());
    expect(readOccurrenceStates([{ occurrence_id: occurrenceId, status: "maybe" }])).toBeNull();
    expect(
      readOccurrenceStates([
        { occurrence_id: occurrenceId, status: "going" },
        { occurrence_id: occurrenceId, status: "interested" },
      ]),
    ).toBeNull();
    expect(readOccurrenceStates(null)).toBeNull();
  });
});
