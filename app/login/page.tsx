import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logIn } from "@/app/auth/actions";
import { AuthPage } from "@/app/components/auth-page";
import { CredentialForm } from "@/app/components/credential-form";
import { loginNotice } from "@/lib/auth";
import { getViewer } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Log in · CampusRadar",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (viewer.status === "authenticated") redirect("/account");

  const params = await searchParams;
  const notice = viewer.status === "unconfigured" ? viewer.message : loginNotice(params.error);

  return (
    <AuthPage title="Log in" lede="Use the email and password for your CampusRadar account.">
      <CredentialForm mode="login" notice={notice} action={logIn} />
    </AuthPage>
  );
}
