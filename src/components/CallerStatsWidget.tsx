import type { CallerStats } from "@/lib/callerStats";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center shadow-sm">
      <p className="text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

export function CallerStatsWidget({ stats }: { stats: CallerStats }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Your day so far
      </p>
      <div className="grid grid-cols-2 gap-2.5 sm:flex">
        <Stat label="Calls dialled" value={stats.today.calls} />
        <Stat label="No answer" value={stats.today.noAnswer} />
        <Stat label="Demos booked" value={stats.today.demosBooked} />
        <Stat label="Follow-ups done" value={stats.today.followUpsDone} />
      </div>
    </div>
  );
}
