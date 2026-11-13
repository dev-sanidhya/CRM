"use client";

import { useEffect, useState } from "react";
import { OUTCOME_META, type Outcome } from "@/lib/outcomes";
import { istParts } from "@/lib/time";
import { DAILY_TARGET, type CalledRow, type DayStats } from "@/lib/queue";

const DAY_START = 10 * 60; // 10:00 IST
const DAY_END = 19 * 60; // 19:00 IST

function tickClass(o: CalledRow["outcome"]) {
  if (o === "demo_booked") return "bg-demo";
  if (!o) return "bg-line-strong";
  if (o === "connected") return "bg-call";
  const kind = OUTCOME_META[o as Outcome]?.kind;
  if (kind === "talk") return "bg-call";
  if (o === "not_interested" || o === "dnc") return "bg-lost/70";
  return "bg-ink/45";
}

/**
 * The day at a glance: one tick per dial, filled in the order they were
 * made. Grey = didn't connect, green = spoke, blue = demo, red = closed.
 */
export function DialMeter({ called, stats }: { called: CalledRow[]; stats: DayStats }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const p = istParts();
      setMinutes(p.hour * 60 + p.minute);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const ordered = [...called].reverse();
  const dials = Math.max(stats.dials, called.length);
  const slots = Math.max(DAILY_TARGET, dials);

  let pace: string | null = null;
  if (minutes !== null && minutes >= DAY_START && minutes <= DAY_END && dials < DAILY_TARGET) {
    const expected = Math.round((DAILY_TARGET * (minutes - DAY_START)) / (DAY_END - DAY_START));
    pace = dials >= expected ? "On pace" : `${expected - dials} behind pace`;
  } else if (dials >= DAILY_TARGET) {
    pace = "Target reached";
  }

  return (
    <section aria-label="Today's dials" className="rounded-2xl border border-line bg-surface px-4 pb-4 pt-3.5 sm:px-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-ink">
          <span className="text-3xl font-semibold tabular-nums tracking-tight">{dials}</span>
          <span className="text-base text-muted"> of {DAILY_TARGET} dials</span>
          {pace && (
            <span className={`ml-3 text-sm font-medium ${pace === "On pace" || pace === "Target reached" ? "text-call" : "text-amber"}`}>
              {pace}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Stat label="spoke" value={stats.connected} tone="text-call" />
          <Stat label="demos" value={stats.demos} tone="text-demo" />
          <Stat label="follow-ups done" value={stats.follow_ups_done} />
          <Stat label="this week" value={stats.week_dials} />
        </div>
      </div>
      <div className="flex gap-[3px]" role="img" aria-label={`${dials} of ${DAILY_TARGET} dials made`}>
        {Array.from({ length: slots }).map((_, i) => {
          const c = ordered[i];
          return (
            <span
              key={i}
              className={`h-6 min-w-0 flex-1 rounded-[2px] transition-colors duration-300 ${
                c ? tickClass(c.outcome) : i < dials ? "bg-ink/45" : "bg-sunken"
              } ${i === DAILY_TARGET - 1 && slots > DAILY_TARGET ? "mr-1.5" : ""}`}
            />
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className={`font-semibold tabular-nums ${tone ?? "text-ink"}`}>{value}</span>
      <span className="text-muted">{label}</span>
    </p>
  );
}
