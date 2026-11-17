import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/stages";
import { outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { formatWhen } from "@/lib/time";
import { DAILY_TARGET, EMPTY_STATS, type DayStats } from "@/lib/queue";

const STAGE_BAR: Record<Stage, string> = {
  new: "bg-line-strong",
  attempted: "bg-ink/40",
  contacted: "bg-amber",
  qualified: "bg-call",
  meeting_booked: "bg-demo",
  proposal_sent: "bg-demo/70",
  won: "bg-call",
  lost: "bg-lost/70",
};

function hoursAgoIso(h: number) {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

export default async function TeamPage() {
  const { profile } = await getCurrentUserAndProfile();
  if (profile?.role !== "founder") redirect("/today");

  const supabase = await createClient();
  const { data: callers } = await supabase.from("profiles").select("id, name").eq("role", "caller").order("name");
  const ids = (callers ?? []).map((c) => c.id);

  const [statsList, { data: recent }, { data: demos }, { data: stageRows }, { count: importCount }] = await Promise.all([
    Promise.all(ids.map((id) => supabase.rpc("get_day_stats", { p_caller: id }))),
    ids.length
      ? supabase
          .from("activities")
          .select("id, actor, outcome, summary, created_at, next_at, leads:lead_id(id, business_name, city)")
          .eq("type", "call")
          .in("actor", ids)
          .order("created_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] }),
    supabase
      .from("reminders")
      .select("id, due_at, note, leads:lead_id(id, business_name, city, phone)")
      .eq("kind", "demo")
      .neq("status", "done")
      .gte("due_at", hoursAgoIso(6))
      .order("due_at")
      .limit(20),
    supabase.rpc("get_stage_counts"),
    supabase.from("sheet_imports").select("id", { count: "exact", head: true }),
  ]);

  const stageCounts = new Map<string, number>(((stageRows as { stage: string; n: number }[]) ?? []).map((r) => [r.stage, Number(r.n)]));
  const totalLeads = [...stageCounts.values()].reduce((a, b) => a + b, 0);
  const nameOf = new Map((callers ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Team</h1>

      {(callers ?? []).length === 0 && <p className="text-sm text-muted">No caller accounts yet.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {(callers ?? []).map((c, i) => {
          const s = (statsList[i]?.data as DayStats) ?? EMPTY_STATS;
          const pct = Math.min(100, Math.round((s.dials / DAILY_TARGET) * 100));
          const connectRate = s.week_dials ? Math.round((s.week_connected / s.week_dials) * 100) : 0;
          return (
            <section key={c.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[17px] font-semibold text-ink">{c.name}</h2>
                <Link href={`/today?caller=${c.id}`} className="text-sm font-medium text-muted hover:text-ink">
                  Open their list
                </Link>
              </div>
              <p className="text-ink">
                <span className="text-3xl font-semibold tabular-nums">{s.dials}</span>
                <span className="text-muted"> of {DAILY_TARGET} dials today</span>
              </p>
              <div className="my-3 h-2 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-call" style={{ width: `${pct}%` }} />
              </div>
              <dl className="grid grid-cols-3 gap-y-3 text-sm">
                <Metric label="Spoke today" value={s.connected} />
                <Metric label="Decks sent today" value={s.decks ?? 0} />
                <Metric label="Demos today" value={s.demos} />
                <Metric label="Follow-ups done" value={s.follow_ups_done} />
                <Metric label="Dials this week" value={s.week_dials} />
                <Metric label="Connect rate (week)" value={`${connectRate}%`} />
                <Metric label="Overdue" value={s.overdue} warn={s.overdue > 0} />
                <Metric label="Due tomorrow" value={s.due_tomorrow} />
                <Metric label="All-time dials" value={s.all_time_dials} />
                <Metric label="All-time demos" value={s.all_time_demos} />
                <Metric label="Decks this week" value={s.week_decks ?? 0} />
                <Metric label="Deck follow-ups open" value={s.decks_open ?? 0} />
              </dl>
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Latest calls</h2>
          {!recent || recent.length === 0 ? (
            <p className="text-sm text-faint">No calls logged yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((a) => {
                const lead = a.leads as unknown as { id: string; business_name: string; city: string | null } | null;
                const tone = outcomeTone(a.outcome);
                return (
                  <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-faint sm:w-28">{formatWhen(a.created_at)}</span>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${tone.soft}`}>{outcomeLabel(a.outcome) || "Call"}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${lead?.id}?from=/team`} className="break-words font-medium text-ink hover:underline">
                        {lead?.business_name ?? "Deleted lead"}
                      </Link>
                      <span className="text-faint">{`  ${nameOf.get(a.actor) ?? ""}`}</span>
                      {a.summary && a.summary !== outcomeLabel(a.outcome) && <p className="truncate text-muted">{a.summary}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Upcoming demos</h2>
            {!demos || demos.length === 0 ? (
              <p className="text-sm text-faint">None booked.</p>
            ) : (
              <ul className="space-y-2.5">
                {demos.map((d) => {
                  const lead = d.leads as unknown as { id: string; business_name: string; city: string | null; phone: string } | null;
                  return (
                    <li key={d.id} className="text-sm">
                      <p className="font-medium text-demo">{formatWhen(d.due_at)}</p>
                      <Link href={`/leads/${lead?.id}?from=/team`} className="text-ink hover:underline">
                        {lead?.business_name}
                      </Link>
                      <p className="text-muted">{[lead?.city, lead?.phone].filter(Boolean).join(", ")}</p>
                      {d.note && d.note !== "Demo booked" && <p className="text-faint">{d.note}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Pipeline</h2>
            {totalLeads > 0 && (
              <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-sunken">
                {STAGES.map((st) => {
                  const n = stageCounts.get(st) ?? 0;
                  return n ? <div key={st} className={STAGE_BAR[st]} style={{ width: `${(n / totalLeads) * 100}%` }} title={`${STAGE_LABELS[st]}: ${n}`} /> : null;
                })}
              </div>
            )}
            <dl className="space-y-1 text-sm">
              {STAGES.map((st) => (
                <div key={st} className="flex items-center justify-between">
                  <dt className="flex items-center gap-2 text-muted">
                    <span className={`h-2 w-2 rounded-full ${STAGE_BAR[st]}`} />
                    {STAGE_LABELS[st]}
                  </dt>
                  <dd className="tabular-nums text-ink">{stageCounts.get(st) ?? 0}</dd>
                </div>
              ))}
            </dl>
            <Link href="/sheets" className="mt-4 block text-sm font-medium text-muted hover:text-ink">
              {totalLeads.toLocaleString("en-IN")} leads from {importCount ?? 0} imports. Manage imports
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${warn ? "text-lost" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
