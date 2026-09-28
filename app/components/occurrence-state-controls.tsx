"use client";

import { useActionState } from "react";
import { saveOccurrenceState } from "@/app/occurrence-state-actions";
import {
  OCCURRENCE_STATUSES,
  OCCURRENCE_STATUS_LABELS,
  nextOccurrenceRequest,
  type OccurrenceStatus,
} from "@/lib/occurrence-states";

export function OccurrenceStateControls({
  occurrenceId,
  status,
}: {
  occurrenceId: string;
  status: OccurrenceStatus | null;
}) {
  const [state, formAction, pending] = useActionState(saveOccurrenceState, undefined);

  return (
    <form action={formAction} className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <input type="hidden" name="occurrence_id" value={occurrenceId} />
      <div role="group" aria-label="Your plans for this event" className="flex flex-wrap gap-2">
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
              title={selected ? `Clear ${OCCURRENCE_STATUS_LABELS[option]}` : undefined}
              className={
                selected
                  ? "rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                  : "rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm font-medium text-zinc-800 hover:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500"
              }
            >
              {OCCURRENCE_STATUS_LABELS[option]}
            </button>
          );
        })}
      </div>
      {state?.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
