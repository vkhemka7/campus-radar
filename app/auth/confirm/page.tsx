import type { Metadata } from "next";
import Link from "next/link";
import { confirmEmail } from "@/app/auth/actions";
import { AuthPage } from "@/app/components/auth-page";
import { CONFIRMATION_NOTICES, confirmationPageModel } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm email · CampusRadar",
};

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const model = confirmationPageModel(toSearchParams(await searchParams));

  if (model.kind === "notice") {
    return (
      <AuthPage title="Confirm email" lede={CONFIRMATION_NOTICES[model.notice]}>
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            Log in
          </Link>
          {" · "}
          <Link href="/signup" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            Sign up
          </Link>
        </p>
      </AuthPage>
    );
  }

  const callback = model.callback;
  return (
    <AuthPage
      title="Confirm email"
      lede="This page does not confirm your account by itself. Choose Confirm email to finish."
    >
      <form action={confirmEmail} className="mt-6">
        {callback.kind === "otp" ? (
          <>
            <input type="hidden" name="token_hash" value={callback.tokenHash} />
            <input type="hidden" name="type" value={callback.type} />
          </>
        ) : (
          <>
            <input type="hidden" name="code" value={callback.code} />
            {callback.flowId ? <input type="hidden" name="sb_flow_id" value={callback.flowId} /> : null}
          </>
        )}
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950"
        >
          Confirm email
        </button>
      </form>
    </AuthPage>
  );
}

function toSearchParams(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") search.set(key, first);
  }
  return search;
}
