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
    <AuthPage
      title="Find your next thing."
      lede="Save events, choose your interests, and get a campus digest that’s relevant to you."
    >
      {viewer.status === "unconfigured" ? (
        <p role="alert" className="notice notice-error">
          {viewer.message}
        </p>
      ) : null}
      <CredentialForm mode="signup" notice={null} action={signUp} />
    </AuthPage>
  );
}
