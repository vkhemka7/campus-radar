"use client";

import { useActionState } from "react";
import { setNewPassword } from "@/app/auth/actions";
import type { AuthCallback } from "@/lib/auth";

export function ResetPasswordForm({
  callback,
}: {
  callback: Exclude<AuthCallback, { kind: "failure" }> | null;
}) {
  const [state, formAction, pending] = useActionState(
    setNewPassword,
    undefined,
  );

  return (
    <form action={formAction} className="form-stack">
      {state?.status === "error" ? (
        <p role="alert" className="notice notice-error">
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
          {callback.flowId ? (
            <input type="hidden" name="sb_flow_id" value={callback.flowId} />
          ) : null}
        </>
      ) : null}
      <label className="field">
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={72}
        />
      </label>
      <label className="field">
        Confirm password
        <input
          type="password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={72}
        />
      </label>
      <p className="form-help">Use at least 6 characters.</p>
      <button type="submit" disabled={pending} className="button">
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
