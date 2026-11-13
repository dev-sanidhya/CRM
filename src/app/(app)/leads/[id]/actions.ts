"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGES } from "@/lib/stages";

async function userId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

export async function addNote(leadId: string, formData: FormData) {
  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) return;
  const supabase = await createClient();
  const uid = await userId(supabase);
  if (!uid) return;
  await supabase.from("activities").insert({ lead_id: leadId, actor: uid, type: "note", summary, source: "typed" });
  revalidatePath(`/leads/${leadId}`);
}

export async function changeStage(leadId: string, formData: FormData) {
  const stage = String(formData.get("stage") ?? "");
  if (!STAGES.includes(stage as (typeof STAGES)[number])) return;
  const supabase = await createClient();
  const uid = await userId(supabase);
  if (!uid) return;

  const closed = stage === "lost" || stage === "won";
  await supabase
    .from("leads")
    .update({ stage, closed_at: closed ? new Date().toISOString() : null, closed_reason: closed ? stage : null })
    .eq("id", leadId);
  await supabase.from("activities").insert({
    lead_id: leadId,
    actor: uid,
    type: "status_change",
    summary: `Stage changed to ${stage.replace(/_/g, " ")}`,
    source: "typed",
    to_stage: stage,
  });
  revalidatePath(`/leads/${leadId}`);
}

export async function reassignLead(leadId: string, formData: FormData) {
  const assignedTo = String(formData.get("assigned_to") ?? "") || null;
  const supabase = await createClient();
  await supabase.from("leads").update({ assigned_to: assignedTo }).eq("id", leadId);
  revalidatePath(`/leads/${leadId}`);
}

export async function completeReminder(leadId: string, reminderId: string) {
  const supabase = await createClient();
  await supabase
    .from("reminders")
    .update({ status: "done", completed_at: new Date().toISOString(), resolution_note: "Cleared by hand" })
    .eq("id", reminderId);
  revalidatePath(`/leads/${leadId}`);
}

export async function deleteNote(leadId: string, activityId: string) {
  const supabase = await createClient();
  await supabase.from("activities").delete().eq("id", activityId).neq("type", "call");
  revalidatePath(`/leads/${leadId}`);
}
