import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StagePill } from "@/components/StagePill";
import { VoiceLogger } from "@/components/VoiceLogger";
import { ActivityForm } from "@/components/ActivityForm";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/stages";
import { formatDateTime } from "@/lib/format";
import { changeStage, reassignLead, addReminder } from "./actions";

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  linkedin: "LinkedIn",
  note: "Note",
  status_change: "Stage change",
};

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile } = await getCurrentUserAndProfile();
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!lead) notFound();

  const { data: activities } = await supabase
    .from("activities")
    .select("id, type, summary, created_at, source, answered, profiles:actor(name)")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, due_at, note, status")
    .eq("lead_id", id)
    .order("due_at", { ascending: true });

  const isFounder = profile?.role === "founder";
  let callers: { id: string; name: string }[] = [];
  if (isFounder) {
    const { data } = await supabase.from("profiles").select("id, name");
    callers = data ?? [];
  }

  const extraFields = (lead.extra_fields ?? {}) as Record<string, string>;
  const extraEntries = Object.entries(extraFields).filter(([, v]) => v);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            {lead.business_name}
          </h1>
          <p className="text-sm text-zinc-500">
            {lead.city ?? "—"}
            {lead.website && (
              <>
                {" · "}
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-700 hover:text-accent hover:underline"
                >
                  {lead.website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
        </div>
        <a
          href={`tel:${lead.phone}`}
          className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm shadow-accent/25 transition hover:opacity-90 sm:w-auto"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M4.2 2h2l1 3-1.5 1a8 8 0 0 0 4.3 4.3l1-1.5 3 1v2c0 .8-.7 1.4-1.4 1.3A11.5 11.5 0 0 1 2.9 3.4C2.8 2.7 3.4 2 4.2 2Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          {lead.phone}
        </a>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Stage
          </p>
          <div className="mb-3">
            <StagePill stage={lead.stage as Stage} />
          </div>
          <form action={changeStage.bind(null, id)} className="flex gap-2">
            <select
              name="stage"
              defaultValue={lead.stage}
              className="flex-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
            >
              Update
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Assigned to
          </p>
          {isFounder ? (
            <form action={reassignLead.bind(null, id)} className="flex gap-2">
              <select
                name="assigned_to"
                defaultValue={lead.assigned_to ?? ""}
                className="flex-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Unassigned</option>
                {callers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
              >
                Set
              </button>
            </form>
          ) : (
            <p className="text-sm text-zinc-700">{profile?.name}</p>
          )}
        </div>
      </div>

      {extraEntries.length > 0 && (
        <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            From the sheet
          </p>
          <dl className="grid grid-cols-1 gap-2 text-sm">
            {extraEntries.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-zinc-500">{k}</dt>
                <dd className="text-zinc-800">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Reminders
        </p>
        {reminders && reminders.length > 0 ? (
          <ul className="mb-4 space-y-1.5">
            {reminders.map((r) => (
              <li key={r.id} className="text-sm text-zinc-700">
                <span className="font-medium">{formatDateTime(r.due_at)}</span>
                {r.note && <span className="text-zinc-500"> — {r.note}</span>}
                {r.status !== "pending" && (
                  <span className="ml-1.5 text-xs text-zinc-400">({r.status})</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-zinc-500">No reminders set.</p>
        )}
        <form action={addReminder.bind(null, id)} className="flex flex-col gap-2 sm:flex-row">
          <input
            type="datetime-local"
            name="due_at"
            required
            className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <input
            type="text"
            name="note"
            placeholder="Follow up about…"
            className="flex-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
          >
            Add
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Activity
        </p>

        <VoiceLogger leadId={id} />

        <ActivityForm leadId={id} />

        <ol className="space-y-4 border-l border-zinc-200 pl-4">
          {activities?.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-zinc-300" />
              <p className="text-xs text-zinc-500">
                {ACTIVITY_TYPE_LABELS[a.type] ?? a.type}
                {a.answered !== null && (
                  <span className={a.answered ? "text-emerald-600" : "text-red-600"}>
                    {" "}
                    · {a.answered ? "Answered" : "No answer"}
                  </span>
                )}{" "}
                · {(a.profiles as unknown as { name: string } | null)?.name ?? "—"} ·{" "}
                {formatDateTime(a.created_at)}
              </p>
              <p className="text-sm text-zinc-800">{a.summary}</p>
            </li>
          ))}
          {(!activities || activities.length === 0) && (
            <p className="text-sm text-zinc-500">No activity logged yet.</p>
          )}
        </ol>
      </div>
    </div>
  );
}
