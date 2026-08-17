"use client";

import { useActionState } from "react";
import { pullSheet, type PullResult } from "./actions";

export function PullForm() {
  const [state, formAction, pending] = useActionState<PullResult | null, FormData>(
    pullSheet,
    null,
  );

  return (
    <div>
      <form action={formAction} className="mb-6 flex gap-2">
        <input
          type="url"
          name="url"
          required
          placeholder="Paste today's Google Sheet link"
          className="flex-1 rounded-xl border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Pulling…" : "Pull"}
        </button>
      </form>

      {state && state.ok && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-medium">Pulled {state.total} rows — {state.layoutLabel}</p>
          <p className="mt-1 text-emerald-700">
            {state.newCount} new lead{state.newCount === 1 ? "" : "s"}, {state.updatedCount}{" "}
            updated{state.skipped > 0 && `, ${state.skipped} skipped (missing phone/name)`}.
          </p>
        </div>
      )}

      {state && !state.ok && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">{state.error}</p>
          {state.headers && (
            <p className="mt-2 text-xs text-red-700">
              Headers found: {state.headers.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
