"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/lib/auth";

export function CredentialForm({
  mode,
  notice,
  action,
}: {
  mode: "login" | "signup";
  notice: string | null;
  action: (
    state: AuthFormState | undefined,
    formData: FormData,
  ) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const email = state?.email ?? "";
  const confirming = state?.status === "confirm_email";
  const message = state?.message ?? notice;

  return (
    <form action={formAction} className="form-stack">
      {confirming ? (
        <p role="status" className="notice">
          <span className="font-medium">Check your email. </span>
          {state.message}
        </p>
      ) : message ? (
        <p role="alert" className="notice notice-error">
          {message}
        </p>
      ) : null}
      <label className="field">
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={email}
        />
      </label>
      <label className="field">
        Password
        <input
          type="password"
          name="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={6}
          maxLength={72}
        />
      </label>
      {mode === "signup" ? (
        <p className="form-help">Use at least 6 characters.</p>
      ) : null}
      <button type="submit" disabled={pending} className="button">
        {pending
          ? mode === "login"
            ? "Logging in…"
            : "Creating account…"
          : mode === "login"
            ? "Log in"
            : "Sign up"}
      </button>
      <p className="form-help">
        {mode === "login" ? (
          <>
            Need an account? <Link href="/signup">Sign up</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/login">Log in</Link>
          </>
        )}
      </p>
    </form>
  );
}
