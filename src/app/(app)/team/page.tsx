import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getTeamTotals, getStageFunnel } from "@/lib/callerStats";
import { CallerCard } from "@/components/CallerCard";
import { STAGE_LABELS, type Stage } from "@/lib/stages";

function TotalBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-center shadow-sm">
      <p className="text-2xl font-bold tracking-tight text-accent">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
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

  const callerIds = (callers ?? []).map((c) => c.id);
  const [totals, funnel] = await Promise.all([
    getTeamTotals(supabase, callerIds),
    getStageFunnel(supabase),
  ]);
  const funnelTotal = funnel.reduce((sum, f) => sum + f.count, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-bold tracking-tight text-zinc-900">Team</h1>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Team totals — all time
      </p>
      <div className="mb-8 flex gap-2.5">
        <TotalBlock label="Calls dialled" value={totals.calls} />
        <TotalBlock label="No answer" value={totals.noAnswer} />
        <TotalBlock label="Demos booked" value={totals.demosBooked} />
        <TotalBlock label="Follow-ups done" value={totals.followUpsDone} />
      </div>

      {funnelTotal > 0 && (
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Pipeline by stage
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100">
              {funnel.map((f) => (
                <div
                  key={f.stage}
                  style={{ width: `${(f.count / funnelTotal) * 100}%` }}
                  className="h-full bg-accent first:rounded-l-full last:rounded-r-full"
                  title={`${STAGE_LABELS[f.stage as Stage]}: ${f.count}`}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
              {funnel.map((f) => (
                <span key={f.stage}>
                  {STAGE_LABELS[f.stage as Stage]}: <strong className="text-zinc-900">{f.count}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {(!callers || callers.length === 0) && (
        <p className="text-sm text-zinc-500">No caller accounts yet.</p>
      )}

      <div className="space-y-8">
        {callers?.map((caller) => (
          <CallerCard key={caller.id} callerId={caller.id} callerName={caller.name} />
        ))}
      </div>
    </div>
  );
}
