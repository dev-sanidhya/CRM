"use client";

import { useActionState } from "react";
import { pullSheet, pullFile, type PullResult } from "./actions";

function ResultBanner({ state }: { state: PullResult | null }) {
  if (!state) return null;

  if (state.ok) {
    return (
      <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <p className="font-medium">Pulled {state.total} rows — {state.layoutLabel}</p>
        <p className="mt-1 text-emerald-700">
          {state.newCount} new lead{state.newCount === 1 ? "" : "s"}, {state.updatedCount}{" "}
          updated{state.skipped > 0 && `, ${state.skipped} skipped (missing phone/name)`}.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{state.error}</p>
      {state.headers && (
        <p className="mt-2 text-xs text-red-700">Headers found: {state.headers.join(", ")}</p>
      )}
    </div>
  );
}

export function PullForm() {
  const [urlState, urlFormAction, urlPending] = useActionState<PullResult | null, FormData>(
    pullSheet,
    null,
  );
  const [fileState, fileFormAction, filePending] = useActionState<PullResult | null, FormData>(
    pullFile,
    null,
  );

  return (
    <div>
      <form action={urlFormAction} className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          name="url"
          placeholder="Paste today's Google Sheet link"
          className="flex-1 rounded-xl border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          disabled={urlPending}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
        >
          {urlPending ? "Pulling…" : "Pull"}
        </button>
      </form>

      <div className="mb-6 flex items-center gap-3 text-xs text-zinc-400">
        <div className="h-px flex-1 bg-zinc-200" />
        or upload a file
        <div className="h-px flex-1 bg-zinc-200" />
      </div>

      <form action={fileFormAction} className="mb-6 flex flex-col gap-2 sm:flex-row">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv"
          required
          className="flex-1 rounded-xl border border-zinc-200 px-3.5 py-2 text-sm text-zinc-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          disabled={filePending}
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
        >
          {filePending ? "Pulling…" : "Pull file"}
        </button>
      </form>

      <ResultBanner state={urlState} />
      <ResultBanner state={fileState} />
    </div>
  );
}
