"use client";

import { useState } from "react";
import { deleteSheetImport } from "@/app/(app)/sheets/actions";
import { formatWhen } from "@/lib/time";

type Props = {
  id: string;
  sheetUrl: string;
  importedAt: string;
  layoutLabel: string;
  newCount: number;
  updatedCount: number;
  currentCount: number;
  canDelete: boolean;
};

function sourceName(url: string) {
  if (url.startsWith("file:")) return url.slice(5);
  return url.includes("docs.google.com") ? "Google Sheet" : url;
}

export function SheetImportRow({ id, sheetUrl, importedAt, layoutLabel, newCount, updatedCount, currentCount, canDelete }: Props) {
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
    <li className="border-b border-line px-4 py-3 text-sm last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {sheetUrl.startsWith("http") ? (
              <a href={sheetUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {sourceName(sheetUrl)}
              </a>
            ) : (
              sourceName(sheetUrl)
            )}
            <span className="ml-2 font-normal text-faint">{layoutLabel}</span>
          </p>
          <p className="text-muted">
            {formatWhen(importedAt)}. {currentCount} lead{currentCount === 1 ? "" : "s"} on file
            <span className="text-faint">{`, at import ${newCount} new and ${updatedCount} updated`}</span>
          </p>
        </div>
        {canDelete && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="shrink-0 rounded-md px-2 py-1 text-xs text-faint hover:bg-sunken hover:text-lost">
            Delete
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-lost-soft px-3 py-2">
          <p className="flex-1 text-xs text-lost">
            {currentCount > 0
              ? `Delete the ${currentCount} lead${currentCount === 1 ? "" : "s"} from this import, with their calls and follow-ups?`
              : "No leads are attached to this import any more. Delete the record?"}
          </p>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-ink">
            Keep
          </button>
          <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-md bg-lost px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </li>
  );
}
