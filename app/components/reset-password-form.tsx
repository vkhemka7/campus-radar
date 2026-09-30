"use client";

import { useActionState } from "react";
import { setNewPassword } from "@/app/auth/actions";
import type { AuthCallback } from "@/lib/auth";

const fieldClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

export function ResetPasswordForm({ callback }: { callback: Exclude<AuthCallback, { kind: "failure" }> | null }) {
  const [state, formAction, pending] = useActionState(setNewPassword, undefined);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state?.status === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {state.message}
        </p>
      ) : null}
      {callback?.kind === "otp" ? (
        <>
          <input type="hidden" name="token_hash" value={callback.tokenHash} />
          <input type="hidden" name="type" value={callback.type} />
        </>
      ) : callback?.kind === "code" ? (
        <>
          <input type="hidden" name="code" value={callback.code} />
          {callback.flowId ? <input type="hidden" name="sb_flow_id" value={callback.flowId} /> : null}
        </>
      ) : null}
      <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={72}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
        Confirm password
        <input
          type="password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={72}
          className={fieldClass}
        />
      </label>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Use at least 6 characters.</p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
