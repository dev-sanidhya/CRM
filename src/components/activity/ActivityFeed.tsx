"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { formatTime, formatWhen, startOfIstDay } from "@/lib/time";
import { describeChanges, sourceLabel, telegramTag, TELEGRAM_BADGE, type HistoryChanges } from "@/lib/history";

export type FeedEvent = {
  id: string;
  at: string;
  kind: "activity" | "version" | "import";
  type: string;
  outcome: string | null;
  summary: string | null;
  next_at: string | null;
  changes: HistoryChanges | null;
  source: string | null;
  lead_id: string | null;
  business_name: string | null;
  city: string | null;
  category: string | null;
  actor: string | null;
  import_label: string | null;
  import_count: number | null;
  requested_by?: string | null;
};

export type FeedDay = {
  day: string;
  summary: { dials: number; connected: number; decks: number; demos: number; leads: number };
  events: FeedEvent[];
};

export type Feed = { days: FeedDay[]; has_more: boolean };

/**
 * A call also updates the lead (e.g. stage Tried to Spoke). Show that on the
 * call's own line instead of as a second entry right below it.
 */
function mergeCallChanges(events: FeedEvent[]): (FeedEvent & { extra?: HistoryChanges })[] {
  const out: (FeedEvent & { extra?: HistoryChanges })[] = events.map((e) => ({ ...e }));
  const drop = new Set<string>();
  for (const v of out) {
    if (v.kind !== "version" || (v.source !== "call" && v.source !== "telegram") || !v.lead_id) continue;
    const t = new Date(v.at).getTime();
    // A call's changes join the call; a Telegram change joins the note the bot wrote with it.
    const call = out.find(
      (c) =>
        c.kind === "activity" &&
        (v.source === "call" ? c.type === "call" : c.source === "telegram") &&
        c.lead_id === v.lead_id &&
        Math.abs(new Date(c.at).getTime() - t) < 10_000,
    );
    if (call) {
      call.extra = { ...(call.extra ?? {}), ...(v.changes ?? {}) };
      drop.add(v.id);
    }
  }
  return out.filter((e) => !drop.has(e.id));
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function dayTitle(day: string): string {
  const today = startOfIstDay();
  const d = new Date(`${day}T00:00:00Z`);
  const todayKey = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const yKey = new Date(today.getTime() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
  if (day === todayKey) return "Today";
  if (day === yKey) return "Yesterday";
  return dayFmt.format(d);
}

/**
 * Everything that happened, newest first, grouped by day, like a browser's
 * history. Loads three days at a time; search and filters re-query.
 */
export function ActivityFeed({
  initial,
  categories,
  category,
  callers,
  caller,
  isFounder,
}: {
  initial: Feed;
  categories: { key: string; label: string }[];
  category: string;
  callers: { id: string; name: string }[];
  caller: string;
  isFounder: boolean;
}) {
  const sb = useMemo(() => createClient(), []);
  const [days, setDays] = useState<FeedDay[]>(initial.days);
  const [hasMore, setHasMore] = useState(initial.has_more);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const firstRun = useRef(true);

  const catLabel = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c.label])), [categories]);

  useEffect(() => {
    // Readable names for "Assigned to" / "List" changes in lead versions.
    sb.from("profiles")
      .select("id, name")
      .then(({ data }) => {
        const map: Record<string, string> = { ...catLabel };
        for (const p of data ?? []) map[p.id] = p.name;
        setNames(map);
      });
  }, [sb, catLabel]);

  const params = (before: string | null, q: string) => ({
    p_before: before,
    p_days: 3,
    p_caller: caller === "all" ? null : caller,
    p_category: category === "all" ? null : category,
    p_query: q.trim() || null,
  });

  // Re-query when the search changes (debounced). Filters change the URL,
  // which re-renders this component with fresh initial data.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      const { data } = await sb.rpc("get_activity_feed", params(null, query));
      setLoading(false);
      if (data) {
        setDays((data as Feed).days);
        setHasMore((data as Feed).has_more);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function loadOlder() {
    const oldest = days[days.length - 1]?.day ?? null;
    setLoading(true);
    const { data } = await sb.rpc("get_activity_feed", params(oldest, query));
    setLoading(false);
    if (data) {
      setDays((d) => [...d, ...(data as Feed).days]);
      setHasMore((data as Feed).has_more);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11 14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history: company, number or note"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-ink"
          />
        </div>
        {isFounder && callers.length > 0 && (
          <select
            value={caller}
            onChange={(e) => {
              const p = new URLSearchParams(window.location.search);
              p.set("caller", e.target.value);
              window.location.search = p.toString();
            }}
            className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
            aria-label="Whose activity"
          >
            <option value="all">Everyone</option>
            {callers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && days.length === 0 && <p className="text-sm text-faint">Loading...</p>}
      {!loading && days.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted">
          {query ? "Nothing in the history matches that search." : "No activity yet."}
        </div>
      )}

      <div className="space-y-6">
        {days.map((d) => (
          <section key={d.day}>
            <div className="sticky top-[49px] z-10 -mx-1 mb-2 flex flex-wrap items-baseline justify-between gap-x-4 bg-canvas/95 px-1 py-1.5 backdrop-blur md:top-0">
              <h2 className="text-[15px] font-semibold text-ink">{dayTitle(d.day)}</h2>
              <p className="text-sm text-muted">
                <span className="font-medium tabular-nums text-ink">{d.summary.dials}</span> dials
                {", "}
                <span className="font-medium tabular-nums text-call">{d.summary.connected}</span> spoke
                {d.summary.decks > 0 && (
                  <>
                    {", "}
                    <span className="font-medium tabular-nums text-deck">{d.summary.decks}</span> decks
                  </>
                )}
                {d.summary.demos > 0 && (
                  <>
                    {", "}
                    <span className="font-medium tabular-nums text-demo">{d.summary.demos}</span> demos
                  </>
                )}
                {", "}
                <span className="tabular-nums">{d.summary.leads}</span> leads
              </p>
            </div>
            <ol className="overflow-hidden rounded-2xl border border-line bg-surface">
              {mergeCallChanges(d.events).map((e) => (
                <EventRow key={e.id} e={e} names={names} catLabel={catLabel} showCategory={category === "all" && categories.length > 1} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={loadOlder}
          disabled={loading}
          className="mt-6 w-full rounded-xl border border-line bg-surface py-3 text-sm font-medium text-ink hover:border-ink disabled:opacity-50"
        >
          {loading ? "Loading..." : "Show older days"}
        </button>
      )}
      {!hasMore && days.length > 0 && <p className="mt-6 text-center text-xs text-faint">That is the start of the history.</p>}
    </div>
  );
}

function EventRow({
  e,
  names,
  catLabel,
  showCategory,
}: {
  e: FeedEvent & { extra?: HistoryChanges };
  names: Record<string, string>;
  catLabel: Record<string, string>;
  showCategory: boolean;
}) {
  let badge: { text: string; cls: string } | null = null;
  let detail: string[] = [];

  if (e.kind === "import") {
    badge = { text: "Import", cls: "bg-sunken text-ink" };
    detail = [`${e.import_count ?? 0} leads from ${e.import_label ?? "a sheet"}`];
  } else if (e.kind === "version") {
    if (e.type === "created") {
      badge = { text: "Added", cls: "bg-call-soft text-call" };
      detail = [e.source === "edit" ? "New lead" : sourceLabel(e.source)];
    } else {
      badge = { text: e.source === "call" ? "Updated by call" : e.source === "telegram" ? "Telegram" : "Edited", cls: e.source === "telegram" ? "bg-bot-soft text-bot" : "bg-sunken text-muted" };
      detail = describeChanges(e.changes, names);
    }
  } else if (e.type === "call") {
    const tone = outcomeTone(e.outcome);
    badge = { text: outcomeLabel(e.outcome) || "Call", cls: tone.soft };
    if (e.summary && e.summary !== outcomeLabel(e.outcome)) detail.push(e.summary);
    if (e.next_at) detail.push(`Next: ${formatWhen(e.next_at)}`);
    if (e.extra) detail.push(...describeChanges(e.extra, names));
  } else {
    badge = e.source === "telegram"
      ? { text: "Telegram", cls: "bg-bot-soft text-bot" }
      : { text: e.type === "note" ? "Note" : e.type, cls: "bg-sunken text-ink" };
    if (e.summary) detail.push(e.summary);
    if (e.extra) detail.push(...describeChanges(e.extra, names));
  }

  const tg = telegramTag(e.source, e.requested_by);
  const title = e.kind === "import" ? "Leads imported" : e.business_name ?? "Deleted lead";

  return (
    <li className={`flex gap-3 border-b border-line px-4 py-2.5 last:border-0 ${tg ? "border-l-2 border-l-bot bg-bot-soft/40" : ""}`}>
      <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm tabular-nums text-faint">{formatTime(e.at)}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {e.lead_id ? (
            <Link href={`/leads/${e.lead_id}?from=/activity`} className="font-medium text-ink hover:underline">
              {title}
            </Link>
          ) : (
            <span className="font-medium text-ink">{title}</span>
          )}
          {badge && <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.text}</span>}
          {showCategory && e.category && <span className="text-xs text-faint">{catLabel[e.category] ?? e.category}</span>}
        </p>
        {detail.length > 0 && (
          <p className="mt-0.5 text-sm text-muted">{detail.join(". ")}</p>
        )}
      </div>
      {tg ? (
        <span className={`hidden shrink-0 self-start sm:block ${TELEGRAM_BADGE}`}>{e.requested_by ? `asked by ${e.requested_by}` : "via bot"}</span>
      ) : (
        e.actor && <span className="hidden shrink-0 pt-0.5 text-xs text-faint sm:block">{e.actor}</span>
      )}
    </li>
  );
}
