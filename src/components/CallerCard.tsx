import { createClient } from "@/lib/supabase/server";
import { getCallerStats } from "@/lib/callerStats";
import { formatDateTime } from "@/lib/format";

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2.5 text-center">
      <p className="text-xl font-bold tracking-tight text-zinc-900">{value}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
    </div>
  );
}

export async function CallerCard({
  callerId,
  callerName,
}: {
  callerId: string;
  callerName: string;
}) {
  const supabase = await createClient();
  const stats = await getCallerStats(supabase, callerId);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-bold tracking-tight text-zinc-900">{callerName}</h2>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Today</p>
      <div className="mb-5 grid grid-cols-4 gap-2">
        <StatBlock label="Calls dialled" value={stats.today.calls} />
        <StatBlock label="No answer" value={stats.today.noAnswer} />
        <StatBlock label="Demos booked" value={stats.today.demosBooked} />
        <StatBlock label="Follow-ups done" value={stats.today.followUpsDone} />
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">All time</p>
      <div className="mb-5 grid grid-cols-4 gap-2">
        <StatBlock label="Calls dialled" value={stats.allTime.calls} />
        <StatBlock label="No answer" value={stats.allTime.noAnswer} />
        <StatBlock label="Demos booked" value={stats.allTime.demosBooked} />
        <StatBlock label="Follow-ups done" value={stats.allTime.followUpsDone} />
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Follow-up results
      </p>
      {stats.followUpResults.length === 0 ? (
        <p className="text-sm text-zinc-500">No completed follow-ups yet.</p>
      ) : (
        <ul className="space-y-2">
          {stats.followUpResults.map((r) => (
            <li key={r.id} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
              <p className="font-medium text-zinc-800">{r.lead?.business_name ?? "Unknown lead"}</p>
              {r.note && <p className="text-xs text-zinc-500">Was: {r.note}</p>}
              <p className="text-zinc-700">{r.resolution_note || "No result noted"}</p>
              {r.completed_at && (
                <p className="text-xs text-zinc-400">{formatDateTime(r.completed_at)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
