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
  const [state, formAction, pending] = useActionState(
    saveCareerInterests,
    undefined,
  );
  const selectedKey = [...selected].sort().join("\0");

  return (
    <form action={formAction} className="form-stack">
      <InterestNotice state={state} />
      <fieldset key={selectedKey}>
        <legend className="eyebrow">Available interests</legend>
        <ul className="interest-list">
          {interests.map((interest) => (
            <li key={interest.slug}>
              <label>
                <input
                  type="checkbox"
                  name="interest"
                  value={interest.slug}
                  defaultChecked={selected.includes(interest.slug)}
                />
                {interest.label}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <button type="submit" disabled={pending} className="button">
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
      className={success ? "notice notice-success" : "notice notice-error"}
    >
      {state.message}
    </p>
  );
}
