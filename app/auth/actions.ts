"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  confirmationFailureNotice,
  emailConfirmationRedirect,
  interpretSignup,
  loginFailureMessage,
  parseAuthCallback,
  parseCredentials,
  type AuthFormState,
} from "@/lib/auth";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

async function confirmationRedirect(): Promise<string | null> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (!host) return null;
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return emailConfirmationRedirect(`${proto}://${host}`);
}

export async function signUp(_state: AuthFormState | undefined, formData: FormData): Promise<AuthFormState> {
  const credentials = parseCredentials(formData);
  if (!credentials.ok) return credentials.state;

  const client = await createRequestSupabaseClient();
  if (!client.ok) return { status: "error", message: client.error, email: credentials.email };

  const emailRedirectTo = await confirmationRedirect();
  const { data, error } = await client.supabase.auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });

  const outcome = interpretSignup(
    {
      user: data.user,
      session: data.session,
      error: error ? { message: error.message, code: error.code } : null,
    },
    credentials.email,
  );
  if (outcome.kind === "session") redirect("/account");
  if (outcome.kind === "confirm_email") {
    return { status: "confirm_email", message: outcome.message, email: outcome.email };
  }
  return { status: "error", message: outcome.message, email: credentials.email };
}

export async function logIn(_state: AuthFormState | undefined, formData: FormData): Promise<AuthFormState> {
  const credentials = parseCredentials(formData);
  if (!credentials.ok) return credentials.state;

  const client = await createRequestSupabaseClient();
  if (!client.ok) return { status: "error", message: client.error, email: credentials.email };

  const { error } = await client.supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) {
    return {
      status: "error",
      message: loginFailureMessage({ message: error.message, code: error.code }),
      email: credentials.email,
    };
  }
  redirect("/account");
}

/**
 * Spends a confirmation token only after the visitor submits the confirm form.
 * The GET page must not call this.
 */
export async function confirmEmail(formData: FormData) {
  const params = new URLSearchParams();
  for (const key of ["code", "sb_flow_id", "token_hash", "type"]) {
    const value = formData.get(key);
    if (typeof value === "string" && value) params.set(key, value);
  }
  const callback = parseAuthCallback(params);
  if (callback.kind === "failure") redirect(`/auth/confirm?notice=${callback.notice}`);

  const client = await createRequestSupabaseClient();
  if (!client.ok) redirect("/auth/confirm?notice=confirmation_failed");

  const { error } =
    callback.kind === "code"
      ? await client.supabase.auth.exchangeCodeForSession(
          callback.code,
          callback.flowId ? { flowId: callback.flowId } : undefined,
        )
      : await client.supabase.auth.verifyOtp({ type: callback.type, token_hash: callback.tokenHash });

  if (error) {
    redirect(`/auth/confirm?notice=${confirmationFailureNotice({ message: error.message, code: error.code })}`);
  }
  redirect("/account");
}

export async function logOut() {
  const client = await createRequestSupabaseClient();
  if (client.ok) await client.supabase.auth.signOut();
  redirect("/");
}
