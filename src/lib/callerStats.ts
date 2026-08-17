import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfTodayIST } from "@/lib/timezone";

export type CallerStats = {
  callerId: string;
  today: { calls: number; noAnswer: number; demosBooked: number; followUpsDone: number };
  allTime: { calls: number; noAnswer: number; demosBooked: number; followUpsDone: number };
  followUpResults: {
    id: string;
    completed_at: string | null;
    resolution_note: string | null;
    note: string | null;
    lead: { id: string; business_name: string } | null;
  }[];
};

export async function getCallerStats(supabase: SupabaseClient, callerId: string): Promise<CallerStats> {
  const todayStart = startOfTodayIST();

  const [
    callsAllTime,
    callsToday,
    noAnswerAllTime,
    noAnswerToday,
    demosAllTime,
    demosToday,
    followUpsAllTime,
    followUpsToday,
    followUpResultsRes,
  ] = await Promise.all([
    supabase.from("activities").select("*", { count: "exact", head: true }).eq("actor", callerId).eq("type", "call"),
    supabase
      .from("activities")
      .select("*", { count: "exact", head: true })
      .eq("actor", callerId)
      .eq("type", "call")
      .gte("created_at", todayStart),
    supabase
      .from("activities")
      .select("*", { count: "exact", head: true })
      .eq("actor", callerId)
      .eq("type", "call")
      .eq("answered", false),
    supabase
      .from("activities")
      .select("*", { count: "exact", head: true })
      .eq("actor", callerId)
      .eq("type", "call")
      .eq("answered", false)
      .gte("created_at", todayStart),
    supabase
      .from("activities")
      .select("*", { count: "exact", head: true })
      .eq("actor", callerId)
      .eq("type", "status_change")
      .eq("to_stage", "meeting_booked"),
    supabase
      .from("activities")
      .select("*", { count: "exact", head: true })
      .eq("actor", callerId)
      .eq("type", "status_change")
      .eq("to_stage", "meeting_booked")
      .gte("created_at", todayStart),
    supabase
      .from("reminders")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", callerId)
      .eq("status", "done"),
    supabase
      .from("reminders")
      .select("*", { count: "exact", head: true })
      .eq("assigned_to", callerId)
      .eq("status", "done")
      .gte("completed_at", todayStart),
    supabase
      .from("reminders")
      .select("id, completed_at, resolution_note, note, leads:lead_id(id, business_name)")
      .eq("assigned_to", callerId)
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(20),
  ]);

  return {
    callerId,
    today: {
      calls: callsToday.count ?? 0,
      noAnswer: noAnswerToday.count ?? 0,
      demosBooked: demosToday.count ?? 0,
      followUpsDone: followUpsToday.count ?? 0,
    },
    allTime: {
      calls: callsAllTime.count ?? 0,
      noAnswer: noAnswerAllTime.count ?? 0,
      demosBooked: demosAllTime.count ?? 0,
      followUpsDone: followUpsAllTime.count ?? 0,
    },
    followUpResults: (followUpResultsRes.data ?? []).map((r) => ({
      id: r.id,
      completed_at: r.completed_at,
      resolution_note: r.resolution_note,
      note: r.note,
      lead: r.leads as unknown as { id: string; business_name: string } | null,
    })),
  };
}
