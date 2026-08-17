"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getVoiceDraft, saveVoiceLog } from "@/app/(app)/leads/[id]/voice-actions";
import { STAGES, STAGE_LABELS } from "@/lib/stages";
import type { VoiceExtraction } from "@/lib/groq";

type Phase = "idle" | "recording" | "extracting" | "confirming" | "unsupported" | "error";

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VoiceLogger({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<VoiceExtraction | null>(null);
  const [error, setError] = useState("");
  const [applyStage, setApplyStage] = useState(false);
  const [applyReminder, setApplyReminder] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  function startRecording() {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setPhase("unsupported");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      const combined = (finalTranscript + interim).trim();
      transcriptRef.current = combined;
      setTranscript(combined);
    };
    recognition.onerror = () => setPhase("error");
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    setTranscript("");
    setPhase("recording");
    recognition.start();
  }

  async function stopRecording() {
    recognitionRef.current?.stop();
    setPhase("extracting");

    const result = await getVoiceDraft(leadId, transcriptRef.current);
    if (!result.ok) {
      setError(result.error);
      setPhase("error");
      return;
    }
    setDraft(result.draft);
    setApplyStage(Boolean(result.draft.suggested_stage));
    setApplyReminder(Boolean(result.draft.follow_up_date));
    setPhase("confirming");
  }

  async function handleSave() {
    if (!draft) return;
    await saveVoiceLog(leadId, {
      transcript,
      summary: draft.summary,
      answered: draft.call_answered,
      applyStage: applyStage ? draft.suggested_stage : null,
      followUpDate: applyReminder ? draft.follow_up_date : null,
      followUpNote: applyReminder ? draft.follow_up_note : null,
    });
    reset();
    router.refresh();
  }

  function reset() {
    setPhase("idle");
    setTranscript("");
    setDraft(null);
    setError("");
  }

  if (phase === "unsupported") {
    return (
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Voice logging needs a browser with speech recognition support (Chrome
        or Edge). Log this call with the form below instead.
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        onClick={startRecording}
        className="mb-5 flex items-center gap-2 rounded-lg border border-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
      >
        <span className="h-2 w-2 rounded-full bg-red-500" />
        Record a voice note
      </button>
    );
  }

  if (phase === "recording") {
    return (
      <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-red-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Listening…
          </span>
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            Stop
          </button>
        </div>
        <p className="min-h-[2.5rem] text-sm text-zinc-700">
          {transcript || "Start speaking…"}
        </p>
      </div>
    );
  }

  if (phase === "extracting") {
    return (
      <div className="mb-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
        Making sense of that…
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="mb-2">{error || "Something went wrong."}</p>
        <button
          type="button"
          onClick={reset}
          className="text-xs font-medium underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === "confirming" && draft) {
    return (
      <div className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Review before saving
        </p>
        <textarea
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          rows={2}
          className="mb-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />

        <div className="mb-3 flex items-center gap-2 text-sm text-zinc-700">
          <span className="text-xs text-zinc-500">Call outcome:</span>
          <select
            value={draft.call_answered === null ? "" : String(draft.call_answered)}
            onChange={(e) =>
              setDraft({
                ...draft,
                call_answered: e.target.value === "" ? null : e.target.value === "true",
              })
            }
            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Unclear</option>
            <option value="true">Answered</option>
            <option value="false">No answer</option>
          </select>
        </div>

        {draft.suggested_stage && (
          <label className="mb-2 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={applyStage}
              onChange={(e) => setApplyStage(e.target.checked)}
            />
            Move stage to{" "}
            <span className="font-medium">
              {STAGE_LABELS[draft.suggested_stage as (typeof STAGES)[number]]}
            </span>
          </label>
        )}

        {draft.follow_up_date && (
          <div className="mb-2 flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={applyReminder}
              onChange={(e) => setApplyReminder(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <span>Create reminder</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="datetime-local"
                  value={toDatetimeLocal(draft.follow_up_date)}
                  onChange={(e) =>
                    setDraft({ ...draft, follow_up_date: new Date(e.target.value).toISOString() })
                  }
                  className="rounded-lg border border-zinc-200 px-2 py-1 text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
                <input
                  type="text"
                  value={draft.follow_up_note ?? ""}
                  onChange={(e) => setDraft({ ...draft, follow_up_note: e.target.value })}
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-zinc-200 px-3.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground shadow-sm transition hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return null;
}
