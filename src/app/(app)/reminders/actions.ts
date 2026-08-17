"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markDone(reminderId: string) {
  const supabase = await createClient();
  await supabase.from("reminders").update({ status: "done" }).eq("id", reminderId);
  revalidatePath("/reminders");
}

export async function snoozeOneDay(reminderId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reminders")
    .select("due_at")
    .eq("id", reminderId)
    .maybeSingle();
  if (!data) return;

  const next = new Date(data.due_at);
  next.setDate(next.getDate() + 1);

  await supabase
    .from("reminders")
    .update({ due_at: next.toISOString(), status: "snoozed" })
    .eq("id", reminderId);
  revalidatePath("/reminders");
}
