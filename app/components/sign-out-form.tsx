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
        className="header-link header-button"
      >
        {pending ? "Logging out…" : "Log out"}
      </button>
      {state?.message ? (
        <p role="alert" className="header-alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
