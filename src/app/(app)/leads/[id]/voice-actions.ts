"use server";

import { createClient } from "@/lib/supabase/server";
import { extractFromTranscript, type VoiceExtraction } from "@/lib/groq";

export type VoiceDraftResult = { ok: true; draft: VoiceExtraction } | { ok: false; error: string };

/**
 * Turns a spoken note into a clean one-line summary and, if a time was
 * mentioned ("call him Thursday at 4"), the callback time. Saving happens
 * through log_call like any other tap.
 */
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
