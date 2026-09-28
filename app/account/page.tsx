import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthPage } from "@/app/components/auth-page";
import { getViewer } from "@/lib/current-user";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account · CampusRadar",
};

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  }).format(date);
}

export default async function AccountPage() {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") {
    return (
      <AuthPage title="Account" lede="Your account could not be loaded.">
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {viewer.message}
        </p>
      </AuthPage>
    );
  }
  if (viewer.status !== "authenticated") redirect("/login");

  const client = await createRequestSupabaseClient();
  const profileResult = client.ok
    ? await client.supabase.from("profiles").select("id, created_at").eq("id", viewer.user.id).maybeSingle()
    : { data: null, error: { message: client.error } };
  const profile = isProfile(profileResult.data) ? profileResult.data : null;

  return (
    <AuthPage
      title="Account"
      lede="This page is rendered on the server from your session cookie. Refresh it, or return here after browsing events, and you should still be signed in."
    >
      <dl className="mt-6 space-y-3 rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <dt className="font-medium text-zinc-800 dark:text-zinc-200">Email</dt>
          <dd className="mt-1 text-zinc-700 dark:text-zinc-300">{viewer.user.email ?? "No email on this session"}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-800 dark:text-zinc-200">User ID</dt>
          <dd className="mt-1 break-all font-mono text-zinc-700 dark:text-zinc-300">{viewer.user.id}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-800 dark:text-zinc-200">Profile</dt>
          <dd className="mt-1 text-zinc-700 dark:text-zinc-300">
            {profileResult.error
              ? profileResult.error.message
              : profile
                ? `Found. Created ${formatCreatedAt(profile.created_at)}.`
                : "No profiles row was found for this user. Signup should have created one."}
          </dd>
        </div>
        {profile ? (
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Profile ID</dt>
            <dd className="mt-1 break-all font-mono text-zinc-700 dark:text-zinc-300">{profile.id}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-6 text-sm">
        <Link href="/" className="font-medium text-zinc-950 underline dark:text-zinc-50">
          Back to events
        </Link>
      </p>
    </AuthPage>
  );
}

function isProfile(value: unknown): value is { id: string; created_at: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as { id?: unknown; created_at?: unknown };
  return typeof row.id === "string" && typeof row.created_at === "string";
}
