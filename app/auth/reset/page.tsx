import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/app/components/reset-password-form";
import { AuthPage } from "@/app/components/auth-page";
import { CONFIRMATION_NOTICES, recoveryPageModel } from "@/lib/auth";
import { getViewer } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set new password · CampusRadar",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = toSearchParams(await searchParams);
  const hasCallback = params.has("code") || params.has("token_hash") || params.has("error")
    || params.has("error_description") || params.has("notice");

  if (hasCallback) {
    const model = recoveryPageModel(params);
    if (model.kind === "notice") {
      return (
        <AuthPage title="Set new password" lede={CONFIRMATION_NOTICES[model.notice]}>
          <ResetLinks />
        </AuthPage>
      );
    }
    return (
      <AuthPage title="Set new password" lede="Choose a new password for your CampusRadar account.">
        <ResetPasswordForm callback={model.callback} />
      </AuthPage>
    );
  }

  const viewer = await getViewer();
  if (viewer.status === "unconfigured") {
    return (
      <AuthPage title="Set new password" lede="Your password could not be updated.">
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {viewer.message}
        </p>
        <ResetLinks />
      </AuthPage>
    );
  }
  if (viewer.status !== "authenticated") {
    return (
      <AuthPage title="Set new password" lede={CONFIRMATION_NOTICES.recovery_incomplete}>
        <ResetLinks />
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Set new password" lede="Choose a new password for your CampusRadar account.">
      <ResetPasswordForm callback={null} />
    </AuthPage>
  );
}

function ResetLinks() {
  return (
    <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
      <Link href="/login" className="font-medium text-zinc-950 underline dark:text-zinc-50">
        Log in
      </Link>
    </p>
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
