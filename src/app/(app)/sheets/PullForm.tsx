"use client";

import { useActionState, useRef, useState } from "react";
import { pullSheet, pullFile, type PullResult } from "./actions";

function ResultBanner({ state }: { state: PullResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <div className="mt-3 rounded-xl bg-call-soft px-4 py-3 text-sm text-call">
        <p className="font-medium">
          {state.newCount} new lead{state.newCount === 1 ? "" : "s"} added, {state.updatedCount} updated
        </p>
        <p className="mt-0.5 opacity-80">
          {state.total} rows read as {state.layoutLabel}
          {state.skipped > 0 && `. ${state.skipped} skipped for a missing name or phone`}.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl bg-lost-soft px-4 py-3 text-sm text-lost">
      <p className="font-medium">{state.error}</p>
      {state.headers && <p className="mt-1 text-xs opacity-80">Columns found: {state.headers.join(", ")}</p>}
    </div>
  );
}

export function PullForm() {
  const [urlState, urlAction, urlPending] = useActionState<PullResult | null, FormData>(pullSheet, null);
  const [fileState, fileAction, filePending] = useActionState<PullResult | null, FormData>(pullFile, null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileForm = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function takeFile(file: File | undefined) {
    if (!file || !fileInput.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.current.files = dt.files;
    setFileName(file.name);
    fileForm.current?.requestSubmit();
  }

  return (
    <div className="space-y-4">
      <form action={urlAction} className="rounded-2xl border border-line bg-surface p-4">
        <label htmlFor="sheet-url" className="mb-2 block text-sm font-medium text-ink">
          Google Sheet link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="sheet-url"
            type="url"
            name="url"
            required
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-ink"
          />
          <button type="submit" disabled={urlPending} className="rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {urlPending ? "Importing..." : "Import"}
          </button>
        </div>
        <p className="mt-2 text-xs text-faint">The sheet must be shared as anyone with the link can view.</p>
        <ResultBanner state={urlState} />
      </form>

      <form ref={fileForm} action={fileAction}>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging ? "border-ink bg-surface" : "border-line-strong bg-surface/60 hover:border-ink"
          }`}
        >
          <span className="text-sm font-medium text-ink">
            {filePending ? `Importing ${fileName}...` : "Drop an .xlsx, .xls or .csv file here"}
          </span>
          <span className="mt-1 text-xs text-muted">or click to choose one</span>
          <input
            ref={fileInput}
            type="file"
            name="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={(e) => takeFile(e.target.files?.[0])}
          />
        </label>
        <ResultBanner state={fileState} />
      </form>
    </div>
  );
}
