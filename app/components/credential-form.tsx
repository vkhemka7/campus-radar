"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/lib/auth";

const fieldClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

export function CredentialForm({
  mode,
  notice,
  action,
}: {
  mode: "login" | "signup";
  notice: string | null;
  action: (state: AuthFormState | undefined, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const email = state?.email ?? "";
  const confirming = state?.status === "confirm_email";
  const message = state?.message ?? notice;

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {confirming ? (
        <p
          role="status"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <span className="font-medium">Check your email. </span>
          {state.message}
        </p>
      ) : message ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {message}
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={email}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
        Password
        <input
          type="password"
          name="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={6}
          maxLength={72}
          className={fieldClass}
        />
      </label>
      {mode === "signup" ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Use at least 6 characters.</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
      >
        {pending ? (mode === "login" ? "Logging in…" : "Creating account…") : mode === "login" ? "Log in" : "Sign up"}
      </button>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {mode === "login" ? (
          <>
            Need an account?{" "}
            <Link href="/signup" className="font-medium text-zinc-950 underline dark:text-zinc-50">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-zinc-950 underline dark:text-zinc-50">
              Log in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
