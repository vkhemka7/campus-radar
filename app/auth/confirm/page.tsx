import type { Metadata } from "next";
import Link from "next/link";
import { confirmEmail } from "@/app/auth/actions";
import { redirect } from "next/navigation";
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
  const params = toSearchParams(await searchParams);
  const model = confirmationPageModel(params);

  if (model.kind === "notice") {
    return (
      <AuthPage title="Confirm email" lede={CONFIRMATION_NOTICES[model.notice]}>
        <p className="inline-links">
          <Link href="/login">Log in</Link>
          <Link href="/signup">Sign up</Link>
        </p>
      </AuthPage>
    );
  }

  const callback = model.callback;
  if (callback.kind === "otp" && callback.type === "recovery") {
    redirect(`/auth/reset?${params.toString()}`);
  }
  return (
    <AuthPage
      title="Confirm email"
      lede="One last step. Confirm your email to make CampusRadar yours."
    >
      <form action={confirmEmail} className="form-stack">
        {callback.kind === "otp" ? (
          <>
            <input type="hidden" name="token_hash" value={callback.tokenHash} />
            <input type="hidden" name="type" value={callback.type} />
          </>
        ) : (
          <>
            <input type="hidden" name="code" value={callback.code} />
            {callback.flowId ? (
              <input type="hidden" name="sb_flow_id" value={callback.flowId} />
            ) : null}
          </>
        )}
        <button
          type="submit"
          className="button"
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
