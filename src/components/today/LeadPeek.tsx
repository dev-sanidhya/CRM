"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { formatAgo, formatWhen } from "@/lib/time";
import { scriptLines, whatsappLink, DETAILS_MESSAGE } from "@/lib/queue";
import type { SheetLead } from "@/components/today/OutcomeSheet";

type HistoryItem = {
  id: string;
  type: string;
  outcome: string | null;
  summary: string;
  created_at: string;
  next_at: string | null;
};

export type PeekLead = SheetLead & {
  stage?: string;
  due_at?: string | null;
  due_note?: string | null;
  website?: string | null;
};

/** Everything about a lead without leaving the list. */
export function LeadPeek({
  lead,
  onClose,
  onCall,
  onLog,
}: {
  lead: PeekLead;
  onClose: () => void;
  onCall: () => void;
  onLog: () => void;
}) {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [extra, setExtra] = useState<Record<string, string> | null>(lead.extra_fields ?? null);
  const [website, setWebsite] = useState<string | null>(lead.website ?? null);

  useEffect(() => {
    let alive = true;
    const sb = createClient();
    Promise.all([
      sb
        .from("activities")
        .select("id, type, outcome, summary, created_at, next_at")
        .eq("lead_id", lead.id)
        .neq("type", "status_change")
        .order("created_at", { ascending: false })
        .limit(12),
      sb.from("leads").select("extra_fields, website").eq("id", lead.id).maybeSingle(),
    ]).then(([h, l]) => {
      if (!alive) return;
      setHistory((h.data as HistoryItem[]) ?? []);
      if (l.data) {
        setExtra((l.data.extra_fields as Record<string, string>) ?? null);
        setWebsite(l.data.website ?? null);
      }
    });
    return () => {
      alive = false;
    };
  }, [lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const script = scriptLines(extra);
  const scriptKeys = new Set(script.map((s) => s.key));
  const otherFields = Object.entries(extra ?? {}).filter(([k, v]) => v && !scriptKeys.has(k));

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal aria-label={lead.business_name}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20" />
      <aside className="animate-sheet-in relative mt-auto flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:mt-0 sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-tight text-ink">{lead.business_name}</p>
            <p className="mt-0.5 text-sm text-muted">
              {[lead.city, lead.phone].filter(Boolean).join(", ")}
            </p>
            {website && (
              <a href={website} target="_blank" rel="noreferrer" className="text-sm text-demo hover:underline">
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 border-b border-line px-5 py-3">
          <a
            href={`tel:${lead.phone}`}
            onClick={onCall}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-call px-3 py-2.5 text-sm font-semibold text-white"
          >
            Call
          </a>
          <button type="button" onClick={onLog} className="flex-1 rounded-xl bg-sunken px-3 py-2.5 text-sm font-semibold text-ink hover:bg-line">
            Log result
          </button>
          <a
            href={whatsappLink(lead.phone, DETAILS_MESSAGE(lead.business_name))}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-sunken px-3 py-2.5 text-sm font-semibold text-ink hover:bg-line"
          >
            WhatsApp
          </a>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {lead.due_at && (
            <p className="mb-4 rounded-xl bg-amber-soft px-3.5 py-2.5 text-sm text-amber">
              Due {formatWhen(lead.due_at)}
              {lead.due_note ? `: ${lead.due_note}` : ""}
            </p>
          )}

          {script.length > 0 && (
            <dl className="mb-5 space-y-2.5">
              {script.map((s) => (
                <div key={s.key}>
                  <dt className="text-xs text-faint">{s.key}</dt>
                  <dd className="text-sm leading-snug text-ink">{s.text}</dd>
                </div>
              ))}
            </dl>
          )}

          <h3 className="mb-2 text-sm font-semibold text-ink">History</h3>
          {history === null ? (
            <p className="text-sm text-faint">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-faint">Not called yet.</p>
          ) : (
            <ol className="mb-5 space-y-2.5">
              {history.map((h) => {
                const tone = outcomeTone(h.outcome);
                return (
                  <li key={h.id} className="text-sm">
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
                      {h.outcome ? (
                        <span className={`rounded-md px-1.5 py-0.5 font-medium ${tone.soft}`}>{outcomeLabel(h.outcome)}</span>
                      ) : (
                        <span className="font-medium capitalize text-muted">{h.type}</span>
                      )}
                      {formatAgo(h.created_at)}
                      {h.next_at && <span>next: {formatWhen(h.next_at)}</span>}
                    </p>
                    {h.summary && h.summary !== outcomeLabel(h.outcome) && <p className="mt-0.5 text-ink">{h.summary}</p>}
                  </li>
                );
              })}
            </ol>
          )}

          {otherFields.length > 0 && (
            <>
              <h3 className="mb-2 text-sm font-semibold text-ink">From the sheet</h3>
              <dl className="space-y-2">
                {otherFields.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-faint">{k}</dt>
                    <dd className="text-sm text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        <div className="border-t border-line px-5 py-3">
          <Link href={`/leads/${lead.id}?from=/today`} className="text-sm font-medium text-muted hover:text-ink">
            Open full page
          </Link>
        </div>
      </aside>
    </div>
  );
}
