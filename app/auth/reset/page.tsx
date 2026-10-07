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
  const hasCallback =
    params.has("code") ||
    params.has("token_hash") ||
    params.has("error") ||
    params.has("error_description") ||
    params.has("notice");

  if (hasCallback) {
    const model = recoveryPageModel(params);
    if (model.kind === "notice") {
      return (
        <AuthPage
          title="Set new password"
          lede={CONFIRMATION_NOTICES[model.notice]}
        >
          <ResetLinks />
        </AuthPage>
      );
    }
    return (
      <AuthPage
        title="Set new password"
        lede="Choose a new password for your CampusRadar account."
      >
        <ResetPasswordForm callback={model.callback} />
      </AuthPage>
    );
  }

  const viewer = await getViewer();
  if (viewer.status === "unconfigured") {
    return (
      <AuthPage
        title="Set new password"
        lede="Your password could not be updated."
      >
        <p role="alert" className="notice notice-error">
          {viewer.message}
        </p>
        <ResetLinks />
      </AuthPage>
    );
  }
  if (viewer.status !== "authenticated") {
    return (
      <AuthPage
        title="Set new password"
        lede={CONFIRMATION_NOTICES.recovery_incomplete}
      >
        <ResetLinks />
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Set new password"
      lede="Choose a new password for your CampusRadar account."
    >
      <ResetPasswordForm callback={null} />
    </AuthPage>
  );
}

function ResetLinks() {
  return (
    <p className="inline-links">
      <Link href="/login">Log in</Link>
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
