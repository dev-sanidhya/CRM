"use client";

import Link from "next/link";
import { markDone, snoozeOneDay } from "@/app/(app)/reminders/actions";

type Reminder = {
  id: string;
  due_at: string;
  note: string | null;
  leads: { id: string; business_name: string; stage: string } | null;
  profiles?: { name: string } | null;
};

export function ReminderRow({
  reminder,
  showAssignee,
}: {
  reminder: Reminder;
  showAssignee?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <Link
          href={`/leads/${reminder.leads?.id}`}
          className="font-medium text-neutral-900 hover:underline"
        >
          {reminder.leads?.business_name ?? "Unknown lead"}
        </Link>
        {reminder.note && (
          <p className="truncate text-sm text-neutral-500">{reminder.note}</p>
        )}
        <p className="text-xs text-neutral-400">
          {new Date(reminder.due_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          {showAssignee && reminder.profiles?.name && ` · ${reminder.profiles.name}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button
          onClick={() => snoozeOneDay(reminder.id)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          Snooze +1d
        </button>
        <button
          onClick={() => markDone(reminder.id)}
          className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800"
        >
          Done
        </button>
      </div>
    </li>
  );
}
