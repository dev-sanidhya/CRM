import { describeChanges, sourceLabel, type HistoryChanges } from "@/lib/history";
import { formatWhen } from "@/lib/time";

export type Version = {
  id: number;
  version: number;
  changed_at: string;
  action: "created" | "updated" | "baseline";
  source: string;
  changes: HistoryChanges;
  actor: string | null;
};

/** Every version of this lead, newest first: what changed, when, by whom. */
export function VersionHistory({ versions, names }: { versions: Version[]; names: Record<string, string> }) {
  if (versions.length === 0) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Versions</h2>
        <span className="text-xs text-faint">{versions.length} version{versions.length === 1 ? "" : "s"}</span>
      </div>
      <ol className="divide-y divide-line">
        {versions.map((v) => {
          const lines =
            v.action === "baseline"
              ? ["As it was when version history started"]
              : v.action === "created"
                ? [v.source === "edit" ? "Lead created" : `Lead created, ${sourceLabel(v.source)}`]
                : describeChanges(v.changes, names);
          return (
            <li key={v.id} className="flex gap-3 py-2.5">
              <span className="w-9 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted">v{v.version}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-faint">
                  {formatWhen(v.changed_at)}
                  {v.actor ? `, ${v.actor}` : ""}
                  {v.action === "updated" ? `, ${sourceLabel(v.source)}` : ""}
                </p>
                <ul className="mt-0.5 space-y-0.5 text-sm text-ink">
                  {lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
