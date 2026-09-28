"use client";

import { useActionState } from "react";
import { saveCareerInterests } from "@/app/account/interests/actions";
import type { CareerInterest, InterestSaveState } from "@/lib/career-interests";

export function InterestForm({
  interests,
  selected,
}: {
  interests: CareerInterest[];
  selected: string[];
}) {
  const [state, formAction, pending] = useActionState(saveCareerInterests, undefined);
  const selectedKey = [...selected].sort().join("\0");

  return (
    <form action={formAction} className="mt-6">
      <InterestNotice state={state} />
      <fieldset key={selectedKey}>
        <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Available interests</legend>
        <ul className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {interests.map((interest) => (
            <li key={interest.slug}>
              <label className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100">
                <input
                  type="checkbox"
                  name="interest"
                  value={interest.slug}
                  defaultChecked={selected.includes(interest.slug)}
                  className="size-4 accent-zinc-900 dark:accent-zinc-100"
                />
                {interest.label}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
      >
        {pending ? "Saving…" : "Save interests"}
      </button>
    </form>
  );
}

function InterestNotice({ state }: { state: InterestSaveState | undefined }) {
  if (!state) return null;
  const success = state.status === "success";
  return (
    <p
      role={success ? "status" : "alert"}
      className={
        success
          ? "mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
          : "mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      }
    >
      {state.message}
    </p>
  );
}
