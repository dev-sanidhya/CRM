"use client";

import { useMemo, useState } from "react";
import type { CalledRow, DayStats, DemoRow } from "@/lib/queue";
import { formatWhen } from "@/lib/time";

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** The End-of-Day report, written from the day's logs. */
export function EodReport({
  name,
  stats,
  called,
  demos,
  onClose,
}: {
  name: string;
  stats: DayStats;
  called: CalledRow[];
  demos: DemoRow[];
  onClose: () => void;
}) {
  const [extra, setExtra] = useState("");
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    const dials = Math.max(stats.dials, called.length);
    const newDials = Math.max(stats.new_dials, called.filter((c) => c.is_first_attempt).length);
    const bookedToday = called.filter((c) => c.outcome === "demo_booked");
    const decksToday = called.filter((c) => c.outcome === "details_sent");
    const lines = [
      `EOD report: ${name}, ${dateFmt.format(new Date())}`,
      ``,
      `Dials: ${dials} (new ${newDials}, follow-up ${dials - newDials})`,
      `Conversations: ${stats.connected}`,
      `Decks / details sent: ${decksToday.length || stats.decks || 0}`,
      ...decksToday.map((c) => `  ${c.business_name}${c.city ? `, ${c.city}` : ""}: follow up ${c.next_at ? formatWhen(c.next_at) : "not set"}`),
      `Demos booked: ${bookedToday.length || stats.demos}`,
      ...bookedToday.map((c) => `  ${c.business_name}${c.city ? `, ${c.city}` : ""}: ${c.next_at ? formatWhen(c.next_at) : "time not set"}`),
      `Follow-ups done: ${stats.follow_ups_done}`,
      `Due tomorrow: ${stats.due_tomorrow}`,
      `Overdue: ${stats.overdue}`,
      `This week: ${stats.week_dials} dials`,
    ];
    const upcoming = demos.filter((d) => !bookedToday.some((b) => b.lead_id === d.lead_id));
    if (upcoming.length) {
      lines.push(``, `Upcoming demos:`);
      upcoming.slice(0, 6).forEach((d) => lines.push(`  ${d.business_name}: ${formatWhen(d.due_at)}`));
    }
    if (extra.trim()) lines.push(``, `Notes: ${extra.trim()}`);
    return lines.join("\n");
  }, [name, stats, called, demos, extra]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal aria-label="End of day report">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/25" />
      <div className="animate-sheet-in relative w-full max-w-lg rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold text-ink">End of day report</p>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-sunken">
            Close
          </button>
        </div>
        <pre className="mb-3 max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-xl bg-sunken p-3.5 font-sans text-sm leading-relaxed text-ink">
          {text}
        </pre>
        <textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={2}
          placeholder="Anything else? Complaints, issues, leads that need a founder."
          className="mb-3 w-full rounded-xl border border-line px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-ink"
        />
        <div className="flex gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-xl bg-call px-4 py-2.5 text-center text-sm font-semibold text-white"
          >
            Send on WhatsApp
          </a>
          <button type="button" onClick={copy} className="rounded-xl bg-sunken px-4 py-2.5 text-sm font-semibold text-ink hover:bg-line">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
