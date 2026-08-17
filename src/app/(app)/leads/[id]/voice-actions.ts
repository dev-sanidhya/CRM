"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractFromTranscript, type VoiceExtraction } from "@/lib/groq";
import { STAGES } from "@/lib/stages";

export type VoiceDraftResult =
  | { ok: true; draft: VoiceExtraction }
  | { ok: false; error: string };

export async function getVoiceDraft(leadId: string, transcript: string): Promise<VoiceDraftResult> {
  if (!transcript.trim()) return { ok: false, error: "No speech was captured." };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("business_name, city, stage")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: "Lead not found." };

  try {
    const draft = await extractFromTranscript(transcript, {
      businessName: lead.business_name,
      city: lead.city,
      currentStage: lead.stage,
    });
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function saveVoiceLog(
  leadId: string,
  input: {
    transcript: string;
    summary: string;
    answered: boolean | null;
    applyStage: string | null;
    followUpDate: string | null;
    followUpNote: string | null;
  },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("activities").insert({
    lead_id: leadId,
    actor: user.id,
    type: "call",
    summary: input.summary,
    source: "voice",
    raw_transcript: input.transcript,
    answered: input.answered,
  });

  if (input.applyStage && STAGES.includes(input.applyStage as (typeof STAGES)[number])) {
    await supabase.from("leads").update({ stage: input.applyStage }).eq("id", leadId);
    await supabase.from("activities").insert({
      lead_id: leadId,
      actor: user.id,
      type: "status_change",
      summary: `Stage changed to ${input.applyStage.replace(/_/g, " ")}`,
      source: "voice",
      to_stage: input.applyStage,
    });
  }

  if (input.followUpDate) {
    const { data: lead } = await supabase
      .from("leads")
      .select("assigned_to")
      .eq("id", leadId)
      .maybeSingle();

    await supabase.from("reminders").insert({
      lead_id: leadId,
      assigned_to: lead?.assigned_to ?? user.id,
      due_at: new Date(input.followUpDate).toISOString(),
      note: input.followUpNote,
      source: "voice_extracted",
    });
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/reminders");
  revalidatePath("/team");
}
