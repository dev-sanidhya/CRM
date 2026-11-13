import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { TodayBoard } from "@/components/today/TodayBoard";
import { EMPTY_STATS, NEW_PAGE, type DayStats, type QueueData } from "@/lib/queue";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ caller?: string }> }) {
  const [{ user, profile }, { caller }] = await Promise.all([getCurrentUserAndProfile(), searchParams]);
  if (!user || !profile) redirect("/login");

  const supabase = await createClient();
  const isFounder = profile.role === "founder";

  // Founders look at a caller's list; callers always see their own.
  let callers: { id: string; name: string }[] = [];
  let callerId = user.id;
  let callerName = profile.name;
  if (isFounder) {
    const { data } = await supabase.from("profiles").select("id, name").eq("role", "caller").order("name");
    callers = data ?? [];
    const chosen = callers.find((c) => c.id === caller) ?? callers[0];
    if (chosen) {
      callerId = chosen.id;
      callerName = chosen.name;
    }
  }

  const [queue, stats] = await Promise.all([
    supabase.rpc("get_queue", { p_caller: callerId, p_new_limit: NEW_PAGE }),
    supabase.rpc("get_day_stats", { p_caller: callerId }),
  ]);

  const initial: QueueData = (queue.data as QueueData) ?? { rows: [], counts: { due: 0, retry: 0, new: 0, later: 0 }, called: [], demos: [] };

  return (
    <>
      {isFounder && callers.length > 1 && (
        <nav className="mx-auto mb-3 flex max-w-4xl gap-1.5" aria-label="Choose caller">
          {callers.map((c) => (
            <Link
              key={c.id}
              href={`/today?caller=${c.id}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${c.id === callerId ? "bg-ink text-white" : "text-muted hover:bg-surface"}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      {queue.error ? (
        <div className="mx-auto max-w-4xl rounded-2xl border border-lost/30 bg-lost-soft p-5 text-sm text-lost">
          Could not load today&apos;s list: {queue.error.message}
        </div>
      ) : (
        <TodayBoard
          key={callerId}
          initial={initial}
          initialStats={(stats.data as DayStats) ?? EMPTY_STATS}
          callerId={callerId}
          callerName={callerName}
          isFounder={isFounder}
        />
      )}
    </>
  );
}
