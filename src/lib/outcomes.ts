// The fixed list of call results. One tap on any of these logs the call,
// marks it answered or not, moves the lead's stage and schedules what
// happens next, so the caller never fills a form for a dial.

export const OUTCOMES = [
  "no_answer",
  "busy",
  "switched_off",
  "wrong_number",
  "callback",
  "interested",
  "demo_booked",
  "not_interested",
  "dnc",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export type OutcomeKind = "miss" | "talk" | "close";

export const OUTCOME_META: Record<
  Outcome,
  {
    label: string;
    short: string;
    kind: OutcomeKind;
    key: string;
    /** Needs a time before it can be saved (callback, follow-up, demo). */
    needsTime: boolean;
    tone: "ink" | "call" | "amber" | "demo" | "lost";
  }
> = {
  no_answer: { label: "No answer", short: "No answer", kind: "miss", key: "1", needsTime: false, tone: "ink" },
  busy: { label: "Busy / cut", short: "Busy", kind: "miss", key: "2", needsTime: false, tone: "ink" },
  switched_off: { label: "Switched off", short: "Switched off", kind: "miss", key: "3", needsTime: false, tone: "ink" },
  wrong_number: { label: "Wrong number", short: "Wrong number", kind: "close", key: "4", needsTime: false, tone: "lost" },
  callback: { label: "Call back", short: "Callback", kind: "talk", key: "5", needsTime: true, tone: "amber" },
  interested: { label: "Interested", short: "Interested", kind: "talk", key: "6", needsTime: true, tone: "call" },
  demo_booked: { label: "Demo booked", short: "Demo booked", kind: "talk", key: "7", needsTime: true, tone: "demo" },
  not_interested: { label: "Not interested", short: "Not interested", kind: "close", key: "8", needsTime: false, tone: "lost" },
  dnc: { label: "Do not call", short: "Do not call", kind: "close", key: "9", needsTime: false, tone: "lost" },
};

export const MISS_OUTCOMES = OUTCOMES.filter((o) => OUTCOME_META[o].kind === "miss");
export const TALK_OUTCOMES: Outcome[] = ["callback", "interested", "demo_booked", "not_interested", "dnc"];

export function isConnected(o: Outcome | null | undefined): boolean {
  return !!o && o !== "no_answer" && o !== "busy" && o !== "switched_off" && o !== "wrong_number";
}

export function outcomeLabel(o: string | null | undefined): string {
  if (!o) return "";
  return OUTCOME_META[o as Outcome]?.label ?? o.replace(/_/g, " ");
}

/** Tap-to-add notes for conversations. Typing stays optional. */
export const NOTE_CHIPS = [
  "Owner not available",
  "Asked for pricing",
  "Send portfolio on WhatsApp",
  "Already has an agency",
  "Busy, call later",
  "Budget concern",
  "Wants to discuss with partner",
  "Prefers Hindi",
];

/** Away time below this suggests the call never connected. */
export const SHORT_CALL_SECONDS = 25;

export const TONE_CLASSES: Record<string, { solid: string; soft: string; text: string }> = {
  ink: { solid: "bg-ink text-white", soft: "bg-sunken text-ink", text: "text-muted" },
  call: { solid: "bg-call text-white", soft: "bg-call-soft text-call", text: "text-call" },
  amber: { solid: "bg-amber text-white", soft: "bg-amber-soft text-amber", text: "text-amber" },
  demo: { solid: "bg-demo text-white", soft: "bg-demo-soft text-demo", text: "text-demo" },
  lost: { solid: "bg-lost text-white", soft: "bg-lost-soft text-lost", text: "text-lost" },
};

export function outcomeTone(o: string | null | undefined) {
  const meta = o ? OUTCOME_META[o as Outcome] : null;
  return TONE_CLASSES[meta?.tone ?? "ink"];
}
