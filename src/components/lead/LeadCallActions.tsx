"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OUTCOME_META } from "@/lib/outcomes";
import { DETAILS_MESSAGE, messageFor, whatsappLink } from "@/lib/queue";
import { OutcomeSheet, type ActiveCall, type LogInput, type SheetLead } from "@/components/today/OutcomeSheet";

/** Call / Log / WhatsApp for one lead, with the same sheet as Today. */
export function LeadCallActions({ lead }: { lead: SheetLead }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [, startTransition] = useTransition();
  const away = useRef(false);

  useEffect(() => {
    if (!call || call.returnedAt) return;
    const leave = () => (away.current = true);
    const back = () => {
      if (away.current) setCall((c) => (c && !c.returnedAt ? { ...c, returnedAt: Date.now() } : c));
    };
    const onVis = () => (document.visibilityState === "hidden" ? leave() : back());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [call]);

  const log = useCallback(
    async (input: LogInput) => {
      setOpen(false);
      const c = call;
      setCall(null);
      if (input.sendWhatsapp) window.open(whatsappLink(lead.phone, messageFor(input.outcome, lead.business_name)), "_blank");
      const t0 = performance.now();
      const { error } = await createClient().rpc("log_call", {
        p_lead_id: lead.id,
        p_outcome: input.outcome,
        p_note: input.note,
        p_next_at: input.nextAt?.toISOString() ?? null,
        p_call_started_at: c ? new Date(c.startedAt).toISOString() : null,
        p_away_seconds: c ? Math.round(((c.returnedAt ?? Date.now()) - c.startedAt) / 1000) : null,
        p_source: input.source,
        p_transcript: input.transcript,
      });
      const ms = Math.round(performance.now() - t0);
      setMessage(error ? { text: `Not saved: ${error.message}`, error: true } : { text: `${OUTCOME_META[input.outcome].label} logged in ${ms} ms` });
      startTransition(() => router.refresh());
    },
    [call, lead, router],
  );

  return (
    <div>
      <div className="flex gap-2">
        <a
          href={`tel:${lead.phone}`}
          onClick={() => {
            away.current = false;
            setCall({ leadId: lead.id, startedAt: Date.now(), returnedAt: null });
            setOpen(true);
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-call px-4 py-2.5 text-sm font-semibold text-white sm:flex-none"
        >
          Call {lead.phone}
        </a>
        <button
          type="button"
          onClick={() => {
            setCall(null);
            setOpen(true);
          }}
          className="rounded-xl bg-surface px-4 py-2.5 text-sm font-semibold text-ink ring-1 ring-line hover:ring-ink"
        >
          Log result
        </button>
        <a
          href={whatsappLink(lead.phone, DETAILS_MESSAGE(lead.business_name))}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-surface px-4 py-2.5 text-sm font-semibold text-ink ring-1 ring-line hover:ring-ink"
        >
          WhatsApp
        </a>
      </div>
      {message && <p className={`mt-2 text-sm ${message.error ? "text-lost" : "text-call"}`}>{message.text}</p>}
      {open && (
        <OutcomeSheet
          lead={lead}
          call={call}
          onLog={log}
          onClose={() => {
            setOpen(false);
            setCall(null);
          }}
        />
      )}
    </div>
  );
}
