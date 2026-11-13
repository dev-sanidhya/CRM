// All "when" logic runs in IST regardless of where the code executes
// (browser, Vercel in Mumbai, or a laptop set to another timezone).

const IST_OFFSET_MIN = 330;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Wall-clock parts of an instant, as seen in IST. */
export function istParts(d: Date = new Date()) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * MIN);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** The instant for a given IST wall-clock date + time. */
export function istInstant(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MIN * MIN);
}

export function startOfIstDay(d: Date = new Date()): Date {
  const p = istParts(d);
  return istInstant(p.year, p.month, p.day, 0);
}

export function addIstDays(d: Date, days: number, hour: number, minute = 0): Date {
  const p = istParts(new Date(d.getTime() + days * DAY));
  return istInstant(p.year, p.month, p.day, hour, minute);
}

export type TimeChip = { label: string; at: Date };

/** Next working day (Mon to Sat), at a given IST hour. */
function nextWorkday(from: Date, hour: number): Date {
  let d = addIstDays(from, 1, hour);
  while (istParts(d).weekday === 0) d = addIstDays(d, 1, hour);
  return d;
}

/**
 * Quick time choices for callbacks and follow-ups. They adapt to the time
 * of day so there is never a chip for a moment that has already passed.
 */
export function callbackChips(now: Date = new Date()): TimeChip[] {
  const p = istParts(now);
  const chips: TimeChip[] = [];
  const roundTo15 = (d: Date) => new Date(Math.ceil(d.getTime() / (15 * MIN)) * 15 * MIN);

  chips.push({ label: "In 1 hour", at: roundTo15(new Date(now.getTime() + 60 * MIN)) });
  if (p.hour < 15) chips.push({ label: "In 3 hours", at: roundTo15(new Date(now.getTime() + 180 * MIN)) });
  if (p.hour < 17) chips.push({ label: "This evening 6 pm", at: istInstant(p.year, p.month, p.day, 18) });
  const tomorrow = nextWorkday(now, 11);
  const tLabel = istParts(tomorrow).weekday === 1 && p.weekday === 6 ? "Monday" : "Tomorrow";
  chips.push({ label: `${tLabel} 11 am`, at: tomorrow });
  chips.push({ label: `${tLabel} 4 pm`, at: nextWorkday(now, 16) });
  const inTwo = nextWorkday(nextWorkday(now, 11), 11);
  chips.push({ label: `${dayName(inTwo)} 11 am`, at: inTwo });
  return chips;
}

/** Demo slots: whole hours over the next few working days. */
export function demoChips(now: Date = new Date()): TimeChip[] {
  const d1 = nextWorkday(now, 11);
  const d2 = nextWorkday(d1, 11);
  return [
    { label: `${relDay(d1, now)} 11 am`, at: d1 },
    { label: `${relDay(d1, now)} 3 pm`, at: addIstDays(d1, 0, 15) },
    { label: `${dayName(d2)} 11 am`, at: d2 },
    { label: `${dayName(d2)} 3 pm`, at: addIstDays(d2, 0, 15) },
  ];
}

/** Default follow-up for "Interested": two working days out, 11 am. */
export function defaultFollowUp(now: Date = new Date()): Date {
  return nextWorkday(nextWorkday(now, 11), 11);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayName(d: Date): string {
  return DAYS[istParts(d).weekday];
}

function relDay(d: Date, now: Date): string {
  const diff = Math.round((startOfIstDay(d).getTime() - startOfIstDay(now).getTime()) / DAY);
  return diff === 1 ? "Tomorrow" : dayName(d);
}

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function formatTime(d: Date | string): string {
  return timeFmt.format(new Date(d)).replace(" ", " ").toLowerCase();
}

/** "4:00 pm", "Tomorrow 11:00 am", "Mon 4:00 pm", "12 Nov 4:00 pm". */
export function formatWhen(d: Date | string, now: Date = new Date()): string {
  const date = new Date(d);
  const diff = Math.round((startOfIstDay(date).getTime() - startOfIstDay(now).getTime()) / DAY);
  const t = formatTime(date);
  if (diff === 0) return t;
  if (diff === -1) return `Yesterday ${t}`;
  if (diff === 1) return `Tomorrow ${t}`;
  if (diff > 1 && diff < 7) return `${dayName(date)} ${t}`;
  return `${dayFmt.format(date)} ${t}`;
}

/** "just now", "12 min ago", "3 h ago", or a date. */
export function formatAgo(d: Date | string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(d).getTime();
  if (ms < MIN) return "just now";
  if (ms < 60 * MIN) return `${Math.floor(ms / MIN)} min ago`;
  if (ms < 12 * 60 * MIN) return `${Math.floor(ms / (60 * MIN))} h ago`;
  return formatWhen(d, now);
}

/** Value for <input type="datetime-local"> in IST. */
export function toIstInputValue(d: Date): string {
  const p = istParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromIstInputValue(v: string): Date | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return istInstant(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
