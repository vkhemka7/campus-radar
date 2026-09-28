import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signUp } from "@/app/auth/actions";
import { AuthPage } from "@/app/components/auth-page";
import { CredentialForm } from "@/app/components/credential-form";
import { getViewer } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign up · CampusRadar",
};

export default async function SignupPage() {
  const viewer = await getViewer();
  if (viewer.status === "authenticated") redirect("/account");

  return (
    <AuthPage title="Sign up" lede="Create an account with your email and a password.">
      {viewer.status === "unconfigured" ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {viewer.message}
        </p>
      ) : null}
      <CredentialForm mode="signup" notice={null} action={signUp} />
    </AuthPage>
  );
}
