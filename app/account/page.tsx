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

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") {
    return (
      <AuthPage title="Account" lede="Your account could not be loaded.">
        <p role="alert" className="notice notice-error">
          {viewer.message}
        </p>
      </AuthPage>
    );
  }
  if (viewer.status !== "authenticated") redirect("/login");

  const client = await createRequestSupabaseClient();
  const profileResult = client.ok
    ? await client.supabase
        .from("profiles")
        .select("id, created_at")
        .eq("id", viewer.user.id)
        .maybeSingle()
    : { data: null, error: { message: client.error } };
  const profile = isProfile(profileResult.data) ? profileResult.data : null;
  const notice = (await searchParams).notice;
  const passwordUpdated =
    notice === "password_updated" ||
    (Array.isArray(notice) && notice[0] === "password_updated");

  return (
    <AuthPage
      title="Account"
      lede="Your corner of CampusRadar. Keep your interests up to date and make the feed your own."
    >
      {passwordUpdated ? (
        <p role="status" className="notice notice-success">
          Your password was updated.
        </p>
      ) : null}
      <dl className="account-facts">
        <div>
          <dt>Email</dt>
          <dd>{viewer.user.email ?? "No email on this session"}</dd>
        </div>
        <div>
          <dt>On your radar since</dt>
          <dd>
            {profile
              ? formatCreatedAt(profile.created_at)
              : "Your profile details are temporarily unavailable."}
          </dd>
        </div>
      </dl>
      <p className="account-action">
        <Link href="/account/interests">Career interests</Link>
        <span> — the fields that shape For You and your digest.</span>
      </p>
      <p className="inline-links">
        <Link href="/">Back to events</Link>
      </p>
    </AuthPage>
  );
}

function isProfile(
  value: unknown,
): value is { id: string; created_at: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as { id?: unknown; created_at?: unknown };
  return typeof row.id === "string" && typeof row.created_at === "string";
}
