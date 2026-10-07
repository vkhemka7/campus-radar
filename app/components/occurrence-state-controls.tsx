"use client";

import { useActionState } from "react";
import { saveOccurrenceState } from "@/app/occurrence-state-actions";
import {
  OCCURRENCE_STATUSES,
  OCCURRENCE_STATUS_LABELS,
  nextOccurrenceRequest,
  type OccurrenceStatus,
} from "@/lib/occurrence-states";

export function planFeedback(pending: boolean, status: string | undefined) {
  if (pending) {
    return { className: "save-feedback", message: "Saving your plan…" };
  }
  if (status === "success") {
    return {
      className: "save-feedback is-saved",
      message: "Your plan is saved.",
    };
  }
  return { className: "sr-only", message: "" };
}

export function OccurrenceStateControls({
  occurrenceId,
  status,
}: {
  occurrenceId: string;
  status: OccurrenceStatus | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveOccurrenceState,
    undefined,
  );

  const feedback = planFeedback(pending, state?.status);

  return (
    <form action={formAction} className="plan-controls" aria-busy={pending}>
      <input type="hidden" name="occurrence_id" value={occurrenceId} />
      <div
        role="group"
        aria-label="Your plans for this event"
        className="flex flex-wrap gap-2"
      >
        {OCCURRENCE_STATUSES.map((option) => {
          const selected = status === option;
          return (
            <button
              key={option}
              type="submit"
              name="status"
              value={nextOccurrenceRequest(status, option)}
              aria-pressed={selected}
              disabled={pending}
              title={
                selected
                  ? `Clear ${OCCURRENCE_STATUS_LABELS[option]}`
                  : undefined
              }
              className={`plan-button ${selected ? "is-selected" : ""} ${option === "not_interested" ? "dismiss-button" : ""}`}
            >
              {OCCURRENCE_STATUS_LABELS[option]}
            </button>
          );
        })}
      </div>
      <span className={feedback.className} role="status">
        {feedback.message}
      </span>
      {state?.status === "error" ? (
        <p role="alert" className="notice notice-error">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
