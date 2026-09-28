import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InterestForm } from "@/app/account/interests/interest-form";
import { AuthPage } from "@/app/components/auth-page";
import { readCareerInterests, readSelectedInterestSlugs } from "@/lib/career-interests";
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
      <AuthPage title="Career interests" lede="Your career interests could not be loaded.">
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
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
      <AuthPage title="Career interests" lede="Your career interests could not be loaded.">
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {client.error}
        </p>
        <AccountLinks />
      </AuthPage>
    );
  }

  const [catalogResult, selectedResult] = await Promise.all([
    client.supabase.from("career_interests").select("slug, label, sort_order"),
    client.supabase.from("profile_career_interests").select("interest_slug").eq("user_id", viewer.user.id),
  ]);
  const interests = catalogResult.error ? null : readCareerInterests(catalogResult.data);
  const selected = selectedResult.error ? null : readSelectedInterestSlugs(selectedResult.data);

  if (!interests || !selected) {
    return (
      <AuthPage title="Career interests" lede="Your career interests could not be loaded.">
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
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
      lede="Check the career areas you want saved on your account. Saving stores exactly the interests that are checked."
    >
      {interests.length === 0 ? (
        <p className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
          No career interests are available right now.
        </p>
      ) : (
        <InterestForm interests={interests} selected={checked} />
      )}
      <AccountLinks />
    </AuthPage>
  );
}

function AccountLinks() {
  return (
    <p className="mt-6 flex gap-4 text-sm">
      <Link href="/account" className="font-medium text-zinc-950 underline dark:text-zinc-50">
        Back to account
      </Link>
      <Link href="/" className="font-medium text-zinc-950 underline dark:text-zinc-50">
        Back to events
      </Link>
    </p>
  );
}
