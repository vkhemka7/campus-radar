"use client";

import { useActionState } from "react";
import { logOut } from "@/app/auth/actions";

export function SignOutForm() {
  const [state, action, pending] = useActionState(logOut, undefined);
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 disabled:opacity-60 dark:text-zinc-50 dark:decoration-zinc-700"
      >
        {pending ? "Logging out…" : "Log out"}
      </button>
      {state?.message ? <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.message}</p> : null}
    </form>
  );
}
