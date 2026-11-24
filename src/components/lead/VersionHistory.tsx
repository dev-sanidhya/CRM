import { describeChanges, sourceLabel, telegramTag, TELEGRAM_ROW, TELEGRAM_BADGE, type HistoryChanges } from "@/lib/history";
import { formatWhen } from "@/lib/time";

export type Version = {
  id: number;
  version: number;
  changed_at: string;
  action: "created" | "updated" | "baseline";
  source: string;
  requested_by?: string | null;
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
          const tg = telegramTag(v.source, v.requested_by);
          return (
            <li key={v.id} className={`flex gap-3 py-2.5 ${tg ? TELEGRAM_ROW : ""}`}>
              <span className="w-9 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted">v{v.version}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-faint">
                  {formatWhen(v.changed_at)}
                  {tg ? "" : v.actor ? `, ${v.actor}` : ""}
                  {!tg && v.action === "updated" ? `, ${sourceLabel(v.source)}` : ""}
                  {tg && <span className={`ml-2 ${TELEGRAM_BADGE}`}>{tg}</span>}
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
