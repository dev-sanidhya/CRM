"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { formatWhen } from "@/lib/time";
import { deleteNote } from "@/app/(app)/leads/[id]/actions";

export type HistoryEntry = {
  id: string;
  type: string;
  outcome: string | null;
  summary: string;
  created_at: string;
  next_at: string | null;
  source: string;
  actor_name: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  call: "Call",
  email: "Email",
  linkedin: "LinkedIn",
  note: "Note",
  status_change: "Stage",
};

export function HistoryList({ leadId, items }: { leadId: string; items: HistoryEntry[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  async function remove(item: HistoryEntry) {
    setConfirm(null);
    setHidden((h) => new Set(h).add(item.id));
    if (item.type === "call") await createClient().rpc("delete_call", { p_activity_id: item.id });
    else await deleteNote(leadId, item.id);
    startTransition(() => router.refresh());
  }

  const shown = items.filter((i) => !hidden.has(i.id));
  if (shown.length === 0) return <p className="text-sm text-faint">Nothing logged yet.</p>;

  return (
    <ol className="divide-y divide-line">
      {shown.map((a) => {
        const tone = outcomeTone(a.outcome);
        const label = a.outcome ? outcomeLabel(a.outcome) : TYPE_LABELS[a.type] ?? a.type;
        return (
          <li key={a.id} className="group flex gap-3 py-3">
            <span className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-faint">{formatWhen(a.created_at)}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
                <span className={`rounded-md px-1.5 py-0.5 font-medium ${a.outcome ? tone.soft : "bg-sunken text-muted"}`}>{label}</span>
                {a.actor_name}
                {a.source === "voice" && <span>voice</span>}
                {a.next_at && <span className="text-amber">next {formatWhen(a.next_at)}</span>}
              </p>
              {a.summary && a.summary !== label && <p className="mt-1 text-sm text-ink">{a.summary}</p>}
            </div>
            {a.type !== "status_change" &&
              (confirm === a.id ? (
                <span className="flex shrink-0 items-start gap-1">
                  <button type="button" onClick={() => setConfirm(null)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-sunken">
                    Keep
                  </button>
                  <button type="button" onClick={() => remove(a)} className="rounded-md bg-lost px-2 py-1 text-xs font-medium text-white">
                    Delete
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm(a.id)}
                  className="shrink-0 self-start rounded-md px-2 py-1 text-xs text-faint opacity-100 hover:bg-sunken hover:text-lost sm:opacity-0 sm:group-hover:opacity-100"
                >
                  Delete
                </button>
              ))}
          </li>
        );
      })}
    </ol>
  );
}
