"use client";

import { useState } from "react";
import { deleteSheetImport } from "@/app/(app)/sheets/actions";
import { formatDateTime } from "@/lib/format";

type Props = {
  id: string;
  sheetUrl: string;
  importedAt: string;
  layoutLabel: string;
  newCount: number;
  updatedCount: number;
  canDelete: boolean;
};

export function SheetImportRow({
  id,
  sheetUrl,
  importedAt,
  layoutLabel,
  newCount,
  updatedCount,
  canDelete,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  if (deleted) return null;

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteSheetImport(id);
    if (result.ok) setDeleted(true);
    setDeleting(false);
    setConfirming(false);
  }

  return (
    <li className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-neutral-800">{sheetUrl}</p>
          <p className="text-xs text-neutral-500">
            {formatDateTime(importedAt)} · {layoutLabel} · {newCount} new, {updatedCount} updated
          </p>
        </div>
        {canDelete && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
          <p className="flex-1 text-xs text-red-700">
            Delete all leads pulled from this sheet, along with their activity
            and reminders? This can&apos;t be undone.
          </p>
          <button
            onClick={() => setConfirming(false)}
            className="shrink-0 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="shrink-0 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
    </li>
  );
}
