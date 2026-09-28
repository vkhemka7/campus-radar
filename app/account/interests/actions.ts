"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/current-user";
import {
  parseInterestSelection,
  planInterestUpdate,
  readCareerInterests,
  readSelectedInterestSlugs,
  sameInterestSelection,
  type InterestSaveState,
} from "@/lib/career-interests";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

const saveError = "Could not save your interests. Try again.";

export async function saveCareerInterests(
  _state: InterestSaveState | undefined,
  formData: FormData,
): Promise<InterestSaveState> {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return { status: "error", message: viewer.message };
  if (viewer.status !== "authenticated") redirect("/login");

  const client = await createRequestSupabaseClient();
  if (!client.ok) return { status: "error", message: client.error };

  const catalogResult = await client.supabase.from("career_interests").select("slug, label, sort_order");
  if (catalogResult.error) return { status: "error", message: saveError };
  const catalog = readCareerInterests(catalogResult.data);
  if (!catalog) return { status: "error", message: saveError };

  const parsed = parseInterestSelection(
    formData.getAll("interest"),
    new Set(catalog.map((interest) => interest.slug)),
  );
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const currentResult = await client.supabase
    .from("profile_career_interests")
    .select("interest_slug")
    .eq("user_id", viewer.user.id);
  if (currentResult.error) return { status: "error", message: saveError };
  const current = readSelectedInterestSlugs(currentResult.data);
  if (!current) return { status: "error", message: saveError };

  const plan = planInterestUpdate(current, parsed.slugs);
  if (plan.toAdd.length > 0) {
    const { error } = await client.supabase.from("profile_career_interests").insert(
      plan.toAdd.map((interest_slug) => ({
        user_id: viewer.user.id,
        interest_slug,
      })),
    );
    if (error) return { status: "error", message: saveError };
  }

  if (plan.toRemove.length > 0) {
    const { error } = await client.supabase
      .from("profile_career_interests")
      .delete()
      .eq("user_id", viewer.user.id)
      .in("interest_slug", plan.toRemove);
    if (error) return { status: "error", message: saveError };
  }

  if (plan.toAdd.length > 0 || plan.toRemove.length > 0) {
    const confirmed = await client.supabase
      .from("profile_career_interests")
      .select("interest_slug")
      .eq("user_id", viewer.user.id);
    if (confirmed.error) return { status: "error", message: saveError };
    const stored = readSelectedInterestSlugs(confirmed.data);
    if (!stored || !sameInterestSelection(stored, parsed.slugs)) {
      return { status: "error", message: saveError };
    }
  }

  refresh();
  return {
    status: "success",
    message: "Saved your career interests.",
    slugs: parsed.slugs,
  };
}
