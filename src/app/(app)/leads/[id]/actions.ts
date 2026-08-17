"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGES } from "@/lib/stages";

export async function addActivity(leadId: string, formData: FormData) {
  const type = String(formData.get("type") ?? "note");
  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) return;

  const answeredRaw = String(formData.get("answered") ?? "");
  const answered = type === "call" && answeredRaw ? answeredRaw === "true" : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("activities").insert({
    lead_id: leadId,
    actor: user.id,
    type,
    summary,
    source: "typed",
    answered,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/team");
}

export async function changeStage(leadId: string, formData: FormData) {
  const stage = String(formData.get("stage") ?? "");
  if (!STAGES.includes(stage as (typeof STAGES)[number])) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("leads").update({ stage }).eq("id", leadId);
  await supabase.from("activities").insert({
    lead_id: leadId,
    actor: user.id,
    type: "status_change",
    summary: `Stage changed to ${stage.replace(/_/g, " ")}`,
    source: "typed",
    to_stage: stage,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/team");
}

export async function reassignLead(leadId: string, formData: FormData) {
  const assignedTo = String(formData.get("assigned_to") ?? "") || null;

  const supabase = await createClient();
  await supabase.from("leads").update({ assigned_to: assignedTo }).eq("id", leadId);

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function addReminder(leadId: string, formData: FormData) {
  const dueAt = String(formData.get("due_at") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!dueAt) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: lead } = await supabase
    .from("leads")
    .select("assigned_to")
    .eq("id", leadId)
    .maybeSingle();

  await supabase.from("reminders").insert({
    lead_id: leadId,
    assigned_to: lead?.assigned_to ?? user.id,
    due_at: new Date(dueAt).toISOString(),
    note: note || null,
    source: "manual",
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/reminders");
}
