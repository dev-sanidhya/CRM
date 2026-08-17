import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getCallerStats } from "@/lib/callerStats";
import { formatDateTime } from "@/lib/format";

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-2.5 text-center">
      <p className="text-xl font-semibold text-neutral-900">{value}</p>
      <p className="text-[11px] text-neutral-500">{label}</p>
    </div>
  );
}

export default async function TeamPage() {
  const { profile } = await getCurrentUserAndProfile();
  if (profile?.role !== "founder") redirect("/leads");

  const supabase = await createClient();
  const { data: callers } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("role", "caller")
    .order("name");

  const statsByCaller = await Promise.all(
    (callers ?? []).map((c) => getCallerStats(supabase, c.id)),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Team</h1>

      {(!callers || callers.length === 0) && (
        <p className="text-sm text-neutral-500">No caller accounts yet.</p>
      )}

      <div className="space-y-8">
        {callers?.map((caller, i) => {
          const stats = statsByCaller[i];
          return (
            <div
              key={caller.id}
              className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <h2 className="mb-4 text-lg font-semibold text-neutral-900">{caller.name}</h2>

              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Today
              </p>
              <div className="mb-5 grid grid-cols-4 gap-2">
                <StatBlock label="Calls dialled" value={stats.today.calls} />
                <StatBlock label="No answer" value={stats.today.noAnswer} />
                <StatBlock label="Demos booked" value={stats.today.demosBooked} />
                <StatBlock label="Follow-ups done" value={stats.today.followUpsDone} />
              </div>

              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                All time
              </p>
              <div className="mb-5 grid grid-cols-4 gap-2">
                <StatBlock label="Calls dialled" value={stats.allTime.calls} />
                <StatBlock label="No answer" value={stats.allTime.noAnswer} />
                <StatBlock label="Demos booked" value={stats.allTime.demosBooked} />
                <StatBlock label="Follow-ups done" value={stats.allTime.followUpsDone} />
              </div>

              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Follow-up results
              </p>
              {stats.followUpResults.length === 0 ? (
                <p className="text-sm text-neutral-500">No completed follow-ups yet.</p>
              ) : (
                <ul className="space-y-2">
                  {stats.followUpResults.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-neutral-800">
                        {r.lead?.business_name ?? "Unknown lead"}
                      </p>
                      {r.note && <p className="text-xs text-neutral-500">Was: {r.note}</p>}
                      <p className="text-neutral-700">
                        {r.resolution_note || "No result noted"}
                      </p>
                      {r.completed_at && (
                        <p className="text-xs text-neutral-400">{formatDateTime(r.completed_at)}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
