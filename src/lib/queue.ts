import type { Outcome } from "@/lib/outcomes";

export type QueueSection = "due" | "deck" | "retry" | "new";

export type QueueRow = {
  id: string;
  business_name: string;
  city: string | null;
  phone: string;
  stage: string;
  score: number | null;
  attempt_count: number;
  last_called_at: string | null;
  last_outcome: string | null;
  last_note: string | null;
  extra_fields: Record<string, string> | null;
  details_sent_at?: string | null;
  category?: string;
  reminder_id: string | null;
  due_at: string | null;
  due_note: string | null;
  due_kind: string | null;
  retry_at: string | null;
  section: QueueSection;
};

export type CalledRow = {
  id: string;
  lead_id: string;
  outcome: Outcome | "connected" | null;
  summary: string;
  created_at: string;
  next_at: string | null;
  is_first_attempt: boolean;
  business_name: string;
  city: string | null;
  phone: string;
  category?: string;
  /** Client-only: still saving, or failed to save. */
  pending?: boolean;
};

export type DemoRow = {
  id: string;
  lead_id: string;
  due_at: string;
  note: string | null;
  business_name: string;
  city: string | null;
  phone: string;
};

export type QueueData = {
  rows: QueueRow[];
  counts: { due: number; deck?: number; retry: number; new: number; later: number };
  category_counts?: Record<string, number>;
  called: CalledRow[];
  demos: DemoRow[];
};

export type DayStats = {
  dials: number;
  new_dials: number;
  connected: number;
  decks?: number;
  demos: number;
  week_dials: number;
  week_decks?: number;
  decks_open?: number;
  week_connected: number;
  follow_ups_done: number;
  overdue: number;
  due_tomorrow: number;
  all_time_dials: number;
  all_time_demos: number;
};

export const EMPTY_STATS: DayStats = {
  dials: 0,
  new_dials: 0,
  connected: 0,
  decks: 0,
  demos: 0,
  week_dials: 0,
  week_connected: 0,
  follow_ups_done: 0,
  overdue: 0,
  due_tomorrow: 0,
  all_time_dials: 0,
  all_time_demos: 0,
};

export const DAILY_TARGET = 70;
export const NEW_PAGE = 60;

/** Lead fields worth having in front of you while dialling. */
const SCRIPT_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "Opener", re: /opener|pitch|hook|script/i },
  { label: "Ask", re: /question|ask for/i },
  { label: "Why them", re: /trigger|what they do|personali[sz]ation|segment|offer/i },
];

export function scriptLines(extra: Record<string, string> | null | undefined) {
  if (!extra) return [];
  const used = new Set<string>();
  const out: { label: string; key: string; text: string }[] = [];
  for (const { label, re } of SCRIPT_PATTERNS) {
    for (const [key, value] of Object.entries(extra)) {
      if (used.has(key) || !value || !re.test(key)) continue;
      used.add(key);
      out.push({ label, key, text: String(value) });
    }
  }
  return out;
}

export function whatsappLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Sent after "Deck / details sent": she attaches the deck PDF in WhatsApp. */
export const DECK_MESSAGE = (business: string) =>
  `Hi, this is from Aperture. As promised on the call, sharing our deck and details for ${business} here. You can also see our work at https://www.aperturecm.in. I'll check back in a couple of days to answer any questions.`;

export function messageFor(outcome: string, business: string) {
  return outcome === "details_sent" ? DECK_MESSAGE(business) : DETAILS_MESSAGE(business);
}

export const DETAILS_MESSAGE = (business: string) =>
  `Hi, this is from Aperture. Thanks for your time on the call just now. As discussed, here is a quick look at what we do for ${business}: https://www.aperturecm.in. Happy to set up a short demo whenever suits you.`;
