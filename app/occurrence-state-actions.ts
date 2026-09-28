"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/current-user";
import {
  parseOccurrenceStateForm,
  planOccurrenceStateChange,
  readOccurrenceStates,
  type OccurrenceStateSaveState,
} from "@/lib/occurrence-states";
import { createRequestSupabaseClient } from "@/lib/supabase-server";

const saveError = "Could not save that. Try again.";

export async function saveOccurrenceState(
  _state: OccurrenceStateSaveState | undefined,
  formData: FormData,
): Promise<OccurrenceStateSaveState> {
  const viewer = await getViewer();
  if (viewer.status === "unconfigured") return { status: "error", message: viewer.message };
  if (viewer.status !== "authenticated") redirect("/login");

  const parsed = parseOccurrenceStateForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const client = await createRequestSupabaseClient();
  if (!client.ok) return { status: "error", message: client.error };
  const userId = viewer.user.id;

  const currentResult = await client.supabase
    .from("user_occurrence_states")
    .select("occurrence_id, status")
    .eq("user_id", userId)
    .eq("occurrence_id", parsed.occurrenceId);
  const current = currentResult.error ? null : readOccurrenceStates(currentResult.data);
  if (!current) return { status: "error", message: saveError };

  const change = planOccurrenceStateChange(current.get(parsed.occurrenceId) ?? null, parsed.request);
  if (change.kind === "set") {
    const { error } = await client.supabase
      .from("user_occurrence_states")
      .upsert(
        { user_id: userId, occurrence_id: parsed.occurrenceId, status: change.status },
        { onConflict: "user_id,occurrence_id" },
      );
    if (error) return { status: "error", message: saveError };
  } else if (change.kind === "clear") {
    const { error } = await client.supabase
      .from("user_occurrence_states")
      .delete()
      .eq("user_id", userId)
      .eq("occurrence_id", parsed.occurrenceId);
    if (error) return { status: "error", message: saveError };
  }

  refresh();
  return { status: "success" };
}
