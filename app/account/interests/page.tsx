import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InterestForm } from "@/app/account/interests/interest-form";
import { AuthPage } from "@/app/components/auth-page";
import {
  readCareerInterests,
  readSelectedInterestSlugs,
} from "@/lib/career-interests";
import { getViewer } from "@/lib/current-user";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Career interests · CampusRadar",
};

const loadError = "Career interests could not be loaded. Try again.";

export default async function CareerInterestsPage() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") {
    return (
      <AuthPage
        title="Career interests"
        lede="Your career interests could not be loaded."
      >
        <p role="alert" className="notice notice-error">
          {viewer.message}
        </p>
        <AccountLinks />
      </AuthPage>
    );
  }
  if (viewer.status !== "authenticated") redirect("/login");

  const client = await createRequestSupabaseClient();
  if (!client.ok) {
    return (
      <AuthPage
        title="Career interests"
        lede="Your career interests could not be loaded."
      >
        <p role="alert" className="notice notice-error">
          {client.error}
        </p>
        <AccountLinks />
      </AuthPage>
    );
  }

  const [catalogResult, selectedResult] = await Promise.all([
    client.supabase.from("career_interests").select("slug, label, sort_order"),
    client.supabase
      .from("profile_career_interests")
      .select("interest_slug")
      .eq("user_id", viewer.user.id),
  ]);
  const interests = catalogResult.error
    ? null
    : readCareerInterests(catalogResult.data);
  const selected = selectedResult.error
    ? null
    : readSelectedInterestSlugs(selectedResult.data);

  if (!interests || !selected) {
    return (
      <AuthPage
        title="Career interests"
        lede="Your career interests could not be loaded."
      >
        <p role="alert" className="notice notice-error">
          {loadError}
        </p>
        <AccountLinks />
      </AuthPage>
    );
  }

  const available = new Set(interests.map((interest) => interest.slug));
  const checked = selected.filter((slug) => available.has(slug));

  return (
    <AuthPage
      title="Career interests"
      lede="What are you curious about? Pick your fields to shape your For You feed and email digest. You can change them anytime."
    >
      {interests.length === 0 ? (
        <p className="notice">No career interests are available right now.</p>
      ) : (
        <InterestForm interests={interests} selected={checked} />
      )}
      <AccountLinks />
    </AuthPage>
  );
}

function AccountLinks() {
  return (
    <p className="inline-links">
      <Link href="/account">Back to account</Link>
      <Link href="/">Back to events</Link>
    </p>
  );
}
