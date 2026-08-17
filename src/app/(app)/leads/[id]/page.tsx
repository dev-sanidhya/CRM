import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StagePill } from "@/components/StagePill";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/stages";
import { addActivity, changeStage, reassignLead, addReminder } from "./actions";

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
    .select("id, type, summary, created_at, source, profiles:actor(name)")
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {lead.business_name}
        </h1>
        <p className="text-sm text-neutral-500">
          {lead.city ?? "—"} · {lead.phone}
          {lead.website && (
            <>
              {" · "}
              <a
                href={lead.website}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-900 hover:underline"
              >
                {lead.website.replace(/^https?:\/\//, "")}
              </a>
            </>
          )}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Stage
          </p>
          <div className="mb-3">
            <StagePill stage={lead.stage as Stage} />
          </div>
          <form action={changeStage.bind(null, id)} className="flex gap-2">
            <select
              name="stage"
              defaultValue={lead.stage}
              className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Update
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Assigned to
          </p>
          {isFounder ? (
            <form action={reassignLead.bind(null, id)} className="flex gap-2">
              <select
                name="assigned_to"
                defaultValue={lead.assigned_to ?? ""}
                className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
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
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
              >
                Set
              </button>
            </form>
          ) : (
            <p className="text-sm text-neutral-700">{profile?.name}</p>
          )}
        </div>
      </div>

      {extraEntries.length > 0 && (
        <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            From the sheet
          </p>
          <dl className="grid grid-cols-1 gap-2 text-sm">
            {extraEntries.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-neutral-500">{k}</dt>
                <dd className="text-neutral-800">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Reminders
        </p>
        {reminders && reminders.length > 0 ? (
          <ul className="mb-4 space-y-1.5">
            {reminders.map((r) => (
              <li key={r.id} className="text-sm text-neutral-700">
                <span className="font-medium">
                  {new Date(r.due_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                {r.note && <span className="text-neutral-500"> — {r.note}</span>}
                {r.status !== "pending" && (
                  <span className="ml-1.5 text-xs text-neutral-400">({r.status})</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-neutral-500">No reminders set.</p>
        )}
        <form action={addReminder.bind(null, id)} className="flex gap-2">
          <input
            type="datetime-local"
            name="due_at"
            required
            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
          />
          <input
            type="text"
            name="note"
            placeholder="Follow up about…"
            className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Add
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Activity
        </p>
        <form action={addActivity.bind(null, id)} className="mb-5 space-y-2">
          <div className="flex gap-2">
            <select
              name="type"
              defaultValue="call"
              className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
            >
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="linkedin">LinkedIn</option>
              <option value="note">Note</option>
            </select>
          </div>
          <textarea
            name="summary"
            required
            placeholder="What happened?"
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
          >
            Log activity
          </button>
        </form>

        <ol className="space-y-4 border-l border-neutral-200 pl-4">
          {activities?.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-neutral-300" />
              <p className="text-xs text-neutral-500">
                {ACTIVITY_TYPE_LABELS[a.type] ?? a.type} ·{" "}
                {(a.profiles as unknown as { name: string } | null)?.name ?? "—"} ·{" "}
                {new Date(a.created_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="text-sm text-neutral-800">{a.summary}</p>
            </li>
          ))}
          {(!activities || activities.length === 0) && (
            <p className="text-sm text-neutral-500">No activity logged yet.</p>
          )}
        </ol>
      </div>
    </div>
  );
}
