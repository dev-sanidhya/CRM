import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StagePill } from "@/components/StagePill";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/stages";
import { outcomeLabel } from "@/lib/outcomes";
import { formatAgo, formatWhen } from "@/lib/time";
import { scriptLines } from "@/lib/queue";
import { LeadCallActions } from "@/components/lead/LeadCallActions";
import { HistoryList, type HistoryEntry } from "@/components/lead/HistoryList";
import { AutoSubmitSelect } from "@/components/lead/AutoSubmitSelect";
import { addNote, changeCategory, changeStage, completeReminder, reassignLead, setDeckSent } from "./actions";
import { getCategories } from "@/lib/categories";
import { VersionHistory, type Version } from "@/components/lead/VersionHistory";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ id }, { from }, { profile }] = await Promise.all([params, searchParams, getCurrentUserAndProfile()]);
  const backHref = from && (from.startsWith("/leads") || from.startsWith("/today")) ? from : "/leads";
  const isFounder = profile?.role === "founder";
  const supabase = await createClient();

  // Everything in parallel: one round trip's worth of waiting.
  const [{ data: lead }, { data: activities }, { data: reminders }, { data: people }, { data: versions }, { data: allPeople }, categories] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("activities")
      .select("id, type, outcome, summary, created_at, next_at, source, to_stage, requested_by, profiles:actor(name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("reminders").select("id, due_at, note, kind").eq("lead_id", id).neq("status", "done").order("due_at"),
    isFounder ? supabase.from("profiles").select("id, name").order("name") : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from("lead_history")
      .select("id, version, changed_at, action, source, changes, requested_by, profiles:actor(name)")
      .eq("lead_id", id)
      .order("version", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id, name"),
    getCategories(),
  ]);

  if (!lead) notFound();

  const history: HistoryEntry[] = (activities ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    outcome: a.outcome,
    summary:
      a.type === "status_change" && a.to_stage
        ? `Stage set to ${STAGE_LABELS[a.to_stage as Stage] ?? a.to_stage}`
        : a.summary,
    created_at: a.created_at,
    next_at: a.next_at,
    source: a.source,
    requested_by: a.requested_by,
    actor_name: (a.profiles as unknown as { name: string } | null)?.name ?? null,
  }));

  const extra = (lead.extra_fields ?? {}) as Record<string, string>;
  const script = scriptLines(extra);
  const scriptKeys = new Set(script.map((s) => s.key));
  const otherFields = Object.entries(extra).filter(([k, v]) => v && !scriptKeys.has(k));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={backHref} className="mb-3 inline-block text-sm font-medium text-muted hover:text-ink">
        Back
      </Link>

      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{lead.business_name}</h1>
          <StagePill stage={lead.stage as Stage} />
          {lead.details_sent_at && (
            <span className="rounded-md bg-deck-soft px-2 py-0.5 text-xs font-medium text-deck">Deck sent {formatWhen(lead.details_sent_at)}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {[lead.city, lead.phone].filter(Boolean).join(", ")}
          {lead.website && (
            <>
              {"  "}
              <a href={lead.website} target="_blank" rel="noreferrer" className="text-demo hover:underline">
                {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            </>
          )}
        </p>
        <p className="mt-1 text-sm text-faint">
          {lead.attempt_count > 0
            ? `${lead.attempt_count} call${lead.attempt_count === 1 ? "" : "s"}, last ${formatAgo(lead.last_called_at)}: ${outcomeLabel(lead.last_outcome)}`
            : "Not called yet"}
          {lead.retry_at && !lead.closed_at && `. Back in the list ${formatWhen(lead.retry_at)}`}
        </p>
      </header>

      <div className="mb-6">
        <LeadCallActions
          lead={{
            id: lead.id,
            business_name: lead.business_name,
            city: lead.city,
            phone: lead.phone,
            attempt_count: lead.attempt_count,
            last_note: lead.last_note,
            extra_fields: extra,
          }}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-4">
          {script.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="mb-3 text-[15px] font-semibold text-ink">Script</h2>
              <dl className="space-y-3">
                {script.map((s) => (
                  <div key={s.key}>
                    <dt className="text-xs text-faint">{s.key}</dt>
                    <dd className="text-sm leading-relaxed text-ink">{s.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="mb-2 text-[15px] font-semibold text-ink">History</h2>
            <form action={addNote.bind(null, id)} className="mb-2 flex gap-2">
              <input
                name="summary"
                required
                placeholder="Add a note"
                className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-ink"
              />
              <button type="submit" className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white">
                Add
              </button>
            </form>
            <HistoryList leadId={id} items={history} />
          </section>

          <VersionHistory
            versions={(versions ?? []).map((v) => ({
              id: v.id,
              version: v.version,
              changed_at: v.changed_at,
              action: v.action,
              source: v.source,
              requested_by: v.requested_by,
              changes: v.changes,
              actor: (v.profiles as unknown as { name: string } | null)?.name ?? null,
            })) as Version[]}
            names={{
              ...Object.fromEntries((allPeople ?? []).map((p) => [p.id, p.name])),
              ...Object.fromEntries(categories.map((c) => [c.key, c.label])),
            }}
          />
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <AutoSubmitSelect
              key={`stage-${lead.stage}`}
              action={changeStage.bind(null, id)}
              name="stage"
              label="Stage"
              defaultValue={lead.stage}
              options={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            />
            {categories.length > 1 && (
              <AutoSubmitSelect
                key={`cat-${lead.category}`}
                action={changeCategory.bind(null, id)}
                name="category"
                label="List"
                defaultValue={lead.category}
                options={categories.map((c) => ({ value: c.key, label: c.label }))}
              />
            )}
            <form action={setDeckSent.bind(null, id, !lead.details_sent_at)}>
              <span className="mb-1 block text-xs text-faint">Deck / details</span>
              <button
                type="submit"
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${
                  lead.details_sent_at ? "bg-deck-soft text-deck" : "border border-line text-ink hover:border-ink"
                }`}
              >
                {lead.details_sent_at ? "Sent. Tap to unmark" : "Mark as sent"}
              </button>
            </form>
            {isFounder && (
              <AutoSubmitSelect
                key={`owner-${lead.assigned_to ?? ""}`}
                action={reassignLead.bind(null, id)}
                name="assigned_to"
                label="Assigned to"
                defaultValue={lead.assigned_to ?? ""}
                options={[{ value: "", label: "Unassigned" }, ...(people ?? []).map((p) => ({ value: p.id, label: p.name }))]}
              />
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">Coming up</h2>
            {reminders && reminders.length > 0 ? (
              <ul className="space-y-2">
                {reminders.map((r) => (
                  <li key={r.id} className="text-sm">
                    <p className={r.kind === "demo" ? "font-medium text-demo" : "font-medium text-amber"}>
                      {r.kind === "demo" ? "Demo" : r.kind === "callback" ? "Callback" : "Follow-up"} {formatWhen(r.due_at)}
                    </p>
                    {r.note && <p className="text-muted">{r.note}</p>}
                    <form action={completeReminder.bind(null, id, r.id)}>
                      <button type="submit" className="text-xs text-faint hover:text-ink">
                        Clear
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-faint">Nothing scheduled.</p>
            )}
          </section>

          {otherFields.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">From the sheet</h2>
              <dl className="space-y-2">
                {otherFields.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-faint">{k}</dt>
                    <dd className="break-words text-sm text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
