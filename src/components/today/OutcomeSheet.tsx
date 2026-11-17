"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  OUTCOME_META,
  OUTCOMES,
  NOTE_CHIPS,
  SHORT_CALL_SECONDS,
  TONE_CLASSES,
  isTypingTarget,
  type Outcome,
} from "@/lib/outcomes";
import {
  callbackChips,
  demoChips,
  defaultFollowUp,
  formatDuration,
  formatWhen,
  fromIstInputValue,
  toIstInputValue,
  type TimeChip,
} from "@/lib/time";
import { scriptLines } from "@/lib/queue";
import { useSpeech } from "@/lib/useSpeech";
import { getVoiceDraft } from "@/app/(app)/leads/[id]/voice-actions";

export type SheetLead = {
  id: string;
  business_name: string;
  city: string | null;
  phone: string;
  attempt_count: number;
  last_note?: string | null;
  extra_fields?: Record<string, string> | null;
};

export type ActiveCall = { leadId: string; startedAt: number; returnedAt: number | null };

export type LogInput = {
  outcome: Outcome;
  note: string | null;
  nextAt: Date | null;
  source: "typed" | "voice";
  transcript: string | null;
  sendWhatsapp: boolean;
};

const MISS_ROW: Outcome[] = ["no_answer", "busy", "switched_off", "wrong_number"];
const TALK_ROW: Outcome[] = ["callback", "interested", "details_sent", "demo_booked", "not_interested", "dnc"];

export function OutcomeSheet({
  lead,
  call,
  onLog,
  onClose,
}: {
  lead: SheetLead;
  call: ActiveCall | null;
  onLog: (input: LogInput) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [voiceChip, setVoiceChip] = useState<TimeChip | null>(null);
  const [custom, setCustom] = useState<string>("");
  const [showCustom, setShowCustom] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(true);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const noteRef = useRef<HTMLInputElement>(null);
  const speech = useSpeech();

  // Live call timer until the caller comes back to the app.
  useEffect(() => {
    if (!call || call.returnedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call]);

  const elapsed = call ? Math.max(0, Math.round(((call.returnedAt ?? now) - call.startedAt) / 1000)) : null;
  // Fixed button positions (muscle memory); a short call only highlights
  // "No answer" as the likely result, and Enter accepts it.
  const suggested: Outcome | null =
    call && call.returnedAt && elapsed !== null && elapsed < SHORT_CALL_SECONDS ? "no_answer" : null;

  const chips = useMemo(() => {
    if (step === "demo_booked") return demoChips();
    return callbackChips();
  }, [step]);
  const allChips = voiceChip ? [voiceChip, ...chips] : chips;

  function pick(outcome: Outcome) {
    if (!OUTCOME_META[outcome].needsTime) {
      onLog({ outcome, note: note.trim() || null, nextAt: null, source: transcript ? "voice" : "typed", transcript, sendWhatsapp: false });
      return;
    }
    setStep(outcome);
    if ((outcome === "interested" || outcome === "details_sent") && !custom) setCustom(toIstInputValue(defaultFollowUp()));
  }

  function saveWith(at: Date) {
    if (!step) return;
    onLog({
      outcome: step,
      note: note.trim() || null,
      nextAt: at,
      source: transcript ? "voice" : "typed",
      transcript,
      sendWhatsapp: (step === "interested" || step === "details_sent") && sendWhatsapp,
    });
  }

  function addChipNote(text: string) {
    setNote((n) => (n ? (n.includes(text) ? n : `${n}. ${text}`) : text));
  }

  async function toggleMic() {
    if (speech.listening) {
      const text = await speech.stop();
      if (!text) return;
      setTranscript(text);
      setNote((n) => (n ? `${n}. ${text}` : text));
      setVoiceBusy(true);
      setVoiceError("");
      const res = await getVoiceDraft(lead.id, text);
      setVoiceBusy(false);
      if (!res.ok) {
        setVoiceError("Kept your words as the note. Could not read a time from them.");
        return;
      }
      if (res.draft.summary) setNote(res.draft.summary);
      if (res.draft.follow_up_date) {
        const at = new Date(res.draft.follow_up_date);
        if (!isNaN(at.getTime()) && at.getTime() > Date.now()) {
          setVoiceChip({ label: `${formatWhen(at)} (said)`, at });
        }
      }
    } else {
      speech.start();
    }
  }

  // Keyboard: 1 to 9 pick a result, Enter accepts the suggestion,
  // in the time step 1 to 7 pick a time, Esc goes back or closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = isTypingTarget(e.target);
      if (e.key === "Escape") {
        e.preventDefault();
        if (step) setStep(null);
        else onClose();
        return;
      }
      if (typing) return;
      if (!step) {
        const o = OUTCOMES.find((x) => OUTCOME_META[x].key === e.key);
        if (o) {
          e.preventDefault();
          pick(o);
        } else if (e.key === "Enter" && suggested) {
          e.preventDefault();
          pick(suggested);
        } else if (e.key === "n") {
          e.preventDefault();
          noteRef.current?.focus();
        }
      } else {
        const idx = parseInt(e.key, 10);
        if (idx >= 1 && idx <= allChips.length) {
          e.preventDefault();
          saveWith(allChips[idx - 1].at);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const script = scriptLines(lead.extra_fields);
  const onCall = call && !call.returnedAt;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-end sm:p-4" role="dialog" aria-modal aria-label={`Log call with ${lead.business_name}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/25" />
      <div className="animate-sheet-in relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 pb-3 pt-4">
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold text-ink">{lead.business_name}</p>
            <p className="text-sm text-muted">
              {[lead.city, lead.phone].filter(Boolean).join(", ")}
              {lead.attempt_count > 0 && <span className="text-faint">{`, try ${lead.attempt_count + 1}`}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {elapsed !== null && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
                  onCall ? "bg-call-soft text-call" : "bg-sunken text-muted"
                }`}
              >
                {onCall ? `On call ${formatDuration(elapsed)}` : `Back after ${formatDuration(elapsed)}`}
              </span>
            )}
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4">
          {/* Script while dialling */}
          {!step && script.length > 0 && (
            <details open={!!onCall} className="mb-4 rounded-xl bg-sunken px-3.5 py-2.5 text-sm">
              <summary className="cursor-pointer select-none text-xs font-medium text-muted">Script for this lead</summary>
              <dl className="mt-2 space-y-1.5">
                {script.slice(0, 3).map((s) => (
                  <div key={s.key}>
                    <dt className="text-xs text-faint">{s.label}</dt>
                    <dd className="leading-snug text-ink">{s.text}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          {!step && (
            <>
              <p className="mb-2 text-xs font-medium text-muted">Didn&apos;t connect</p>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MISS_ROW.map((o) => (
                  <OutcomeButton key={o} outcome={o} suggested={suggested === o} onClick={() => pick(o)} />
                ))}
              </div>
              <p className="mb-2 text-xs font-medium text-muted">Spoke to them</p>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TALK_ROW.map((o) => (
                  <OutcomeButton key={o} outcome={o} suggested={false} onClick={() => pick(o)} />
                ))}
              </div>
              <NoteField
                note={note}
                setNote={setNote}
                noteRef={noteRef}
                mic={speech.supported ? { listening: speech.listening, busy: voiceBusy, onToggle: toggleMic, live: speech.transcript } : null}
              />
              {suggested && (
                <p className="mt-3 text-xs text-faint">Short call. Press Enter for No answer, or 0 to 9 for any result.</p>
              )}
            </>
          )}

          {step && (
            <>
              <button type="button" onClick={() => setStep(null)} className="mb-3 text-sm font-medium text-muted hover:text-ink">
                Back
              </button>
              <p className="mb-3 text-[15px] font-semibold text-ink">
                {step === "demo_booked"
                  ? "When is the demo?"
                  : step === "details_sent"
                    ? "When to follow up on the deck?"
                    : step === "interested"
                      ? "When to follow up?"
                      : "When to call back?"}
              </p>

              {step !== "demo_booked" && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {NOTE_CHIPS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => addChipNote(c)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        note.includes(c) ? "border-ink bg-ink text-white" : "border-line text-muted hover:border-line-strong hover:text-ink"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-4">
                <NoteField
                  note={note}
                  setNote={setNote}
                  noteRef={noteRef}
                  mic={speech.supported ? { listening: speech.listening, busy: voiceBusy, onToggle: toggleMic, live: speech.transcript } : null}
                />
                {voiceError && <p className="mt-1.5 text-xs text-amber">{voiceError}</p>}
              </div>

              {(step === "interested" || step === "details_sent") && (
                <label className="mb-4 flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={sendWhatsapp} onChange={(e) => setSendWhatsapp(e.target.checked)} className="h-4 w-4 accent-[var(--call)]" />
                  {step === "details_sent" ? "Open WhatsApp with the deck message (attach the PDF there)" : "Open WhatsApp with the details message after saving"}
                </label>
              )}

              <p className="mb-2 text-xs font-medium text-muted">Tap a time to save</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {allChips.map((c, i) => (
                  <button
                    key={c.label + i}
                    type="button"
                    onClick={() => saveWith(c.at)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      i === 0 && voiceChip
                        ? "border-demo bg-demo-soft text-demo"
                        : "border-line bg-surface text-ink hover:border-ink"
                    }`}
                  >
                    <span>{c.label}</span>
                    <kbd className="ml-2 hidden text-[11px] font-normal text-faint sm:inline">{i + 1}</kbd>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setShowCustom(true);
                    if (!custom) setCustom(toIstInputValue(defaultFollowUp()));
                  }}
                  className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left text-sm font-medium text-muted hover:border-ink hover:text-ink"
                >
                  Pick date and time
                </button>
              </div>
              {showCustom && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="datetime-local"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    className="flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const at = fromIstInputValue(custom);
                      if (at) saveWith(at);
                    }}
                    className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white"
                  >
                    Save
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OutcomeButton({ outcome, suggested, onClick }: { outcome: Outcome; suggested: boolean; onClick: () => void }) {
  const meta = OUTCOME_META[outcome];
  const tone = TONE_CLASSES[meta.tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-[transform,background-color] active:scale-[0.98] ${tone.soft} ${
        suggested ? "ring-2 ring-ink ring-offset-2" : "hover:brightness-95"
      }`}
    >
      <span>{meta.label}</span>
      <kbd className="ml-2 hidden text-[11px] font-normal opacity-60 sm:inline">{meta.key}</kbd>
    </button>
  );
}

function NoteField({
  note,
  setNote,
  noteRef,
  mic,
}: {
  note: string;
  setNote: (v: string) => void;
  noteRef: React.RefObject<HTMLInputElement | null>;
  mic: { listening: boolean; busy: boolean; onToggle: () => void; live: string } | null;
}) {
  return (
    <div>
      <div className="flex gap-2">
        <input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-ink"
        />
        {mic && (
          <button
            type="button"
            onClick={mic.onToggle}
            disabled={mic.busy}
            aria-label={mic.listening ? "Stop voice note" : "Speak a note"}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
              mic.listening ? "bg-lost text-white" : "bg-sunken text-ink hover:bg-line"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {mic.busy ? "Reading" : mic.listening ? "Stop" : "Speak"}
          </button>
        )}
      </div>
      {mic?.listening && <p className="mt-1.5 min-h-5 text-sm text-muted">{mic.live || "Listening..."}</p>}
    </div>
  );
}
