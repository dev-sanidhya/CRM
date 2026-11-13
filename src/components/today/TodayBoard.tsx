"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OUTCOME_META, isConnected, outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { formatAgo, formatTime, formatWhen, startOfIstDay } from "@/lib/time";
import {
  DETAILS_MESSAGE,
  NEW_PAGE,
  whatsappLink,
  type CalledRow,
  type DayStats,
  type QueueData,
  type QueueRow,
  type QueueSection,
} from "@/lib/queue";
import { DialMeter } from "@/components/today/DialMeter";
import { OutcomeSheet, type ActiveCall, type LogInput, type SheetLead } from "@/components/today/OutcomeSheet";
import { LeadPeek, type PeekLead } from "@/components/today/LeadPeek";
import { EodReport } from "@/components/today/EodReport";
import { QuickAdd } from "@/components/today/QuickAdd";

type Toast = {
  id: string;
  text: string;
  detail?: string;
  tone: "ok" | "error";
  undo?: () => void;
  retry?: () => void;
};

type Timing = { action: string; ms: number; at: number };

declare global {
  interface Window {
    __crmTimings?: Timing[];
  }
}

const SECTION_TITLES: Record<QueueSection, string> = {
  due: "Due now",
  retry: "Try again",
  new: "Not called yet",
};
const SECTION_HINTS: Record<QueueSection, string> = {
  due: "Callbacks and follow-ups due today, oldest first",
  retry: "Didn't connect last time",
  new: "Fresh leads, best score first",
};
const COLLAPSED = 25;
const ACTIVE_CALL_KEY = "crm.activeCall";

function recordTiming(action: string, ms: number) {
  const list = (window.__crmTimings ??= []);
  list.push({ action, ms: Math.round(ms), at: Date.now() });
  if (list.length > 200) list.shift();
}

function matches(q: string, ...fields: (string | null | undefined)[]) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  return fields.some((f) => {
    if (!f) return false;
    const v = f.toLowerCase();
    if (v.includes(needle)) return true;
    return digits.length >= 3 && v.replace(/\D/g, "").includes(digits);
  });
}

export function TodayBoard({
  initial,
  initialStats,
  callerId,
  callerName,
  isFounder,
}: {
  initial: QueueData;
  initialStats: DayStats;
  callerId: string;
  callerName: string;
  isFounder: boolean;
}) {
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<QueueRow[]>(initial.rows);
  const [counts, setCounts] = useState(initial.counts);
  const [called, setCalled] = useState<CalledRow[]>(initial.called);
  const [demos, setDemos] = useState(initial.demos);
  const [stats, setStats] = useState<DayStats>(initialStats);
  const [newLimit, setNewLimit] = useState(NEW_PAGE);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PeekLead[]>([]);
  const [selected, setSelected] = useState(0);
  const [sheet, setSheet] = useState<SheetLead | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [peek, setPeek] = useState<PeekLead | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showEod, setShowEod] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showCalled, setShowCalled] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pending = useRef(new Map<string, Promise<string>>());
  const awayRef = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReload = useRef(0);
  const logCallRef = useRef<(lead: SheetLead, input: LogInput) => void>(() => {});
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // ---- data ---------------------------------------------------------------

  const reload = useCallback(
    async (limit = newLimit) => {
      const t0 = performance.now();
      const [q, s] = await Promise.all([
        sb.rpc("get_queue", { p_caller: callerId, p_new_limit: limit }),
        sb.rpc("get_day_stats", { p_caller: callerId }),
      ]);
      recordTiming("reload", performance.now() - t0);
      lastReload.current = Date.now();
      if (q.data) {
        const data = q.data as QueueData;
        setRows(data.rows);
        setCounts(data.counts);
        setDemos(data.demos);
        // Keep calls that are still saving at the top.
        setCalled((prev) => [...prev.filter((c) => c.pending), ...data.called]);
      }
      if (s.data) setStats(s.data as DayStats);
    },
    [sb, callerId, newLimit],
  );

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => reload(), 1200);
  }, [reload]);

  // Fresh data when coming back to the tab after a while (not mid-call).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && !activeCall && Date.now() - lastReload.current > 60_000) reload();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload, activeCall]);

  // ---- calling --------------------------------------------------------------

  const startCall = useCallback((lead: SheetLead) => {
    const call = { leadId: lead.id, startedAt: Date.now(), returnedAt: null };
    awayRef.current = false;
    setActiveCall(call);
    setSheet(lead);
    setPeek(null);
    try {
      sessionStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify({ ...call, lead }));
    } catch {}
  }, []);

  const openLog = useCallback((lead: SheetLead) => {
    setActiveCall(null);
    setSheet(lead);
    setPeek(null);
  }, []);

  // Leaving for the phone app and coming back: stop the clock, the sheet
  // is already open on this lead.
  useEffect(() => {
    if (!activeCall || activeCall.returnedAt) return;
    const away = () => {
      awayRef.current = true;
    };
    const back = () => {
      if (!awayRef.current) return;
      setActiveCall((c) => (c && !c.returnedAt ? { ...c, returnedAt: Date.now() } : c));
    };
    const onVis = () => (document.visibilityState === "hidden" ? away() : back());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
    };
  }, [activeCall]);

  // Phones sometimes reload the tab while the dialer is open: pick the
  // call back up where it was.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_CALL_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as ActiveCall & { lead: SheetLead };
      if (Date.now() - saved.startedAt < 2 * 60 * 60 * 1000) {
        // Restoring from browser storage can only happen after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveCall({ leadId: saved.leadId, startedAt: saved.startedAt, returnedAt: Date.now() });
        setSheet(saved.lead);
      } else sessionStorage.removeItem(ACTIVE_CALL_KEY);
    } catch {}
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    setActiveCall(null);
    try {
      sessionStorage.removeItem(ACTIVE_CALL_KEY);
    } catch {}
  }, []);

  // ---- toasts ---------------------------------------------------------------

  const pushToast = useCallback((t: Toast, ms = 6000) => {
    setToasts((list) => [...list.filter((x) => x.id !== t.id), t].slice(-3));
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), ms);
  }, []);
  const patchToast = useCallback((id: string, patch: Partial<Toast>) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // ---- logging (optimistic) -------------------------------------------------

  const deleteCall = useCallback(
    async (id: string, label: string) => {
      setCalled((list) => list.filter((c) => c.id !== id));
      const t0 = performance.now();
      const activityId = pending.current.get(id) ? await pending.current.get(id)!.catch(() => null) : id;
      if (!activityId) return;
      const { error } = await sb.rpc("delete_call", { p_activity_id: activityId });
      recordTiming("undo", performance.now() - t0);
      if (error) pushToast({ id: `del-${id}`, text: "Could not remove that call", detail: error.message, tone: "error" });
      else pushToast({ id: `del-${id}`, text: `Removed: ${label}`, tone: "ok" }, 3000);
      reload();
    },
    [sb, pushToast, reload],
  );

  const logCall = useCallback(
    (lead: SheetLead, input: LogInput) => {
      const call = activeCall && activeCall.leadId === lead.id ? activeCall : null;
      closeSheet();

      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const createdAt = new Date().toISOString();
      const meta = OUTCOME_META[input.outcome];
      const removedIndex = rows.findIndex((r) => r.id === lead.id);
      const removed = removedIndex >= 0 ? rows[removedIndex] : null;

      // 1. The screen updates in the same frame as the tap.
      if (removed) {
        setRows((list) => list.filter((r) => r.id !== lead.id));
        setCounts((c) => ({ ...c, [removed.section]: Math.max(0, c[removed.section] - 1) }));
        setSelected((s) => Math.min(s, Math.max(0, rows.length - 2)));
      }
      setCalled((list) => [
        {
          id: tempId,
          lead_id: lead.id,
          outcome: input.outcome,
          summary: input.note || meta.label,
          created_at: createdAt,
          next_at: input.nextAt?.toISOString() ?? null,
          is_first_attempt: lead.attempt_count === 0,
          business_name: lead.business_name,
          city: lead.city,
          phone: lead.phone,
          pending: true,
        },
        ...list,
      ]);
      setStats((s) => ({
        ...s,
        dials: s.dials + 1,
        week_dials: s.week_dials + 1,
        new_dials: s.new_dials + (lead.attempt_count === 0 ? 1 : 0),
        connected: s.connected + (isConnected(input.outcome) ? 1 : 0),
        demos: s.demos + (input.outcome === "demo_booked" ? 1 : 0),
        follow_ups_done: s.follow_ups_done + (removed?.section === "due" ? 1 : 0),
      }));
      if (input.sendWhatsapp) window.open(whatsappLink(lead.phone, DETAILS_MESSAGE(lead.business_name)), "_blank");

      const label = `${meta.label}: ${lead.business_name}`;
      const t0 = performance.now();
      pushToast({ id: tempId, text: label, detail: "Saving...", tone: "ok", undo: () => deleteCall(tempId, label) });

      // 2. One round trip to the database in the background.
      const promise: Promise<string> = (async () => {
        const { data, error } = await sb.rpc("log_call", {
          p_lead_id: lead.id,
          p_outcome: input.outcome,
          p_note: input.note,
          p_next_at: input.nextAt?.toISOString() ?? null,
          p_call_started_at: call ? new Date(call.startedAt).toISOString() : null,
          p_away_seconds: call ? Math.round(((call.returnedAt ?? Date.now()) - call.startedAt) / 1000) : null,
          p_source: input.source,
          p_transcript: input.transcript,
        });
        if (error) throw new Error(error.message);
        return (data as { activity_id: string }).activity_id;
      })();
      pending.current.set(tempId, promise);

      promise
        .then((activityId) => {
          const ms = performance.now() - t0;
          recordTiming("log_call", ms);
          setCalled((list) => list.map((c) => (c.id === tempId ? { ...c, id: activityId, pending: false } : c)));
          patchToast(tempId, { detail: `Saved in ${Math.round(ms)} ms`, undo: () => deleteCall(activityId, label) });
          scheduleReload();
        })
        .catch((err: Error) => {
          setCalled((list) => list.filter((c) => c.id !== tempId));
          if (removed) setRows((list) => (list.some((r) => r.id === removed.id) ? list : [...list.slice(0, removedIndex), removed, ...list.slice(removedIndex)]));
          reload();
          pushToast(
            { id: tempId, text: `Not saved: ${lead.business_name}`, detail: err.message, tone: "error", retry: () => logCallRef.current(lead, input) },
            12000,
          );
        })
        .finally(() => pending.current.delete(tempId));
    },
    [activeCall, closeSheet, rows, sb, pushToast, patchToast, deleteCall, scheduleReload, reload],
  );

  useEffect(() => {
    logCallRef.current = logCall;
  }, [logCall]);

  useEffect(() => {
    lastReload.current = Date.now();
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ---- search ---------------------------------------------------------------

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(async () => {
      const digits = q.replace(/\D/g, "");
      const term = q.replace(/[%_,()]/g, "");
      const filter =
        digits.length >= 3
          ? `phone.ilike.%${digits}%,business_name.ilike.%${term}%`
          : `business_name.ilike.%${term}%,city.ilike.%${term}%`;
      const { data } = await sb
        .from("leads")
        .select("id, business_name, city, phone, stage, attempt_count, last_note, extra_fields")
        .eq("assigned_to", callerId)
        .or(filter)
        .limit(12);
      setRemote((data as PeekLead[]) ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [query, sb, callerId]);

  // ---- derived --------------------------------------------------------------

  const filtered = useMemo(
    () => (query ? rows.filter((r) => matches(query, r.business_name, r.city, r.phone, r.last_note)) : rows),
    [rows, query],
  );
  const sections = useMemo(() => {
    const by: Record<QueueSection, QueueRow[]> = { due: [], retry: [], new: [] };
    for (const r of filtered) by[r.section].push(r);
    return by;
  }, [filtered]);
  const visible = useMemo(() => {
    const out: QueueRow[] = [];
    (["due", "retry", "new"] as QueueSection[]).forEach((s) => {
      const list = sections[s];
      out.push(...(expanded[s] || query || s === "due" ? list : list.slice(0, COLLAPSED)));
    });
    return out;
  }, [sections, expanded, query]);
  const remoteOnly = useMemo(
    () => (query.trim().length >= 2 ? remote.filter((r) => !rows.some((x) => x.id === r.id)) : []),
    [remote, rows, query],
  );

  const sel = Math.min(selected, Math.max(0, visible.length - 1));

  // ---- keyboard -------------------------------------------------------------

  useEffect(() => {
    if (sheet || peek || showEod || showAdd) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") {
        if (e.key === "Escape") {
          setQuery("");
          el.blur();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const row = visible[sel];
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelected(Math.min(visible.length - 1, sel + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected(Math.max(0, sel - 1));
      } else if (e.key === "Enter" && row) {
        e.preventDefault();
        openLog(row);
      } else if (e.key === "c" && row) {
        e.preventDefault();
        startCall(row);
        window.location.href = `tel:${row.phone}`;
      } else if (e.key === " " && row) {
        e.preventDefault();
        setPeek(row);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "u") {
        const last = called.find((c) => !c.id.startsWith("del-"));
        if (last) deleteCall(last.id, `${outcomeLabel(last.outcome)}: ${last.business_name}`);
      } else if (e.key === "a") {
        e.preventDefault();
        setShowAdd(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, peek, showEod, showAdd, visible, sel, openLog, startCall, called, deleteCall]);

  useEffect(() => {
    const row = visible[sel];
    if (row) rowRefs.current.get(row.id)?.scrollIntoView({ block: "nearest" });
  }, [sel, visible]);

  // ---- render ---------------------------------------------------------------

  const sod = startOfIstDay(new Date(now)).getTime();
  const totalLeft = counts.due + counts.retry + counts.new;
  let index = -1;

  return (
    <div className="mx-auto max-w-4xl">
      <DialMeter called={called} stats={stats} />

      {demos.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm">
          <span className="font-medium text-demo">Demos</span>
          {demos.slice(0, 4).map((d) => (
            <span key={d.id} className="rounded-lg bg-demo-soft px-2 py-0.5 text-demo">
              {d.business_name} {formatWhen(d.due_at)}
            </span>
          ))}
        </div>
      )}

      <div className="sticky top-[49px] z-20 -mx-4 mt-4 flex items-center gap-2 bg-canvas/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:top-0 md:-mx-8 md:px-8">
        <div className="relative min-w-0 flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11 14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find by name, city or last digits of a number"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-ink"
          />
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="shrink-0 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink hover:border-ink">
          Add lead
        </button>
        <button type="button" onClick={() => setShowEod(true)} className="shrink-0 rounded-xl bg-ink px-3 py-2.5 text-sm font-medium text-white">
          <span className="sm:hidden">Report</span>
          <span className="hidden sm:inline">End of day report</span>
        </button>
      </div>

      {isFounder && (
        <p className="mt-2 text-sm text-muted">
          Viewing {callerName}&apos;s list. Anything you log here counts under your name.
        </p>
      )}

      {totalLeft === 0 && !query && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-[17px] font-semibold text-ink">Nothing left to call today</p>
          <p className="mt-1 text-sm text-muted">Import a sheet or add a lead to keep going.</p>
        </div>
      )}

      {(["due", "retry", "new"] as QueueSection[]).map((s) => {
        const list = sections[s];
        if (list.length === 0) return null;
        const shown = expanded[s] || query || s === "due" ? list : list.slice(0, COLLAPSED);
        const total = s === "new" ? counts.new : list.length;
        return (
          <section key={s} className="mt-5">
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="text-[15px] font-semibold text-ink">
                {SECTION_TITLES[s]} <span className="font-normal tabular-nums text-muted">{query ? list.length : total}</span>
              </h2>
              <p className="hidden text-xs text-faint sm:block">{SECTION_HINTS[s]}</p>
            </div>
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
              {shown.map((r) => {
                index += 1;
                const i = index;
                return (
                  <QueueItem
                    key={r.id}
                    row={r}
                    selected={i === sel}
                    sod={sod}
                    now={now}
                    refCb={(el) => {
                      if (el) rowRefs.current.set(r.id, el);
                      else rowRefs.current.delete(r.id);
                    }}
                    onSelect={() => setSelected(i)}
                    onPeek={() => setPeek(r)}
                    onCall={() => startCall(r)}
                    onLog={() => openLog(r)}
                  />
                );
              })}
            </ul>
            {!query && list.length > shown.length && (
              <button type="button" onClick={() => setExpanded((e) => ({ ...e, [s]: true }))} className="mt-2 px-1 text-sm font-medium text-muted hover:text-ink">
                Show all {list.length}
              </button>
            )}
            {!query && s === "new" && expanded.new && counts.new > list.length && (
              <button
                type="button"
                onClick={() => {
                  const next = newLimit + NEW_PAGE;
                  setNewLimit(next);
                  reload(next);
                }}
                className="mt-2 px-1 text-sm font-medium text-muted hover:text-ink"
              >
                Load {Math.min(NEW_PAGE, counts.new - list.length)} more ({counts.new - list.length} not loaded)
              </button>
            )}
          </section>
        );
      })}

      {query && remoteOnly.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 px-1 text-[15px] font-semibold text-ink">Other matches</h2>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {remoteOnly.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <button type="button" onClick={() => setPeek(r)} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium text-ink">{r.business_name}</p>
                  <p className="truncate text-sm text-muted">
                    {[r.city, r.phone, r.stage?.replace(/_/g, " ")].filter(Boolean).join("  ")}
                  </p>
                </button>
                <button type="button" onClick={() => openLog(r)} className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-sunken hover:text-ink sm:block">
                  Log
                </button>
                <a href={`tel:${r.phone}`} onClick={() => startCall(r)} className="rounded-xl bg-call px-4 py-2 text-sm font-semibold text-white">
                  Call
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {called.length > 0 && (
        <section className="mt-6">
          <button type="button" onClick={() => setShowCalled((v) => !v)} className="mb-2 flex w-full items-baseline justify-between px-1 text-left">
            <h2 className="text-[15px] font-semibold text-ink">
              Called today <span className="font-normal tabular-nums text-muted">{called.length}</span>
            </h2>
            <span className="text-sm text-muted">{showCalled ? "Hide" : "Show"}</span>
          </button>
          {showCalled && (
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
              {called.map((c) => {
                const tone = outcomeTone(c.outcome);
                const label = `${outcomeLabel(c.outcome)}: ${c.business_name}`;
                return (
                  <li key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0">
                    <span className="w-16 shrink-0 tabular-nums text-faint">{formatTime(c.created_at)}</span>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${tone.soft}`}>{outcomeLabel(c.outcome)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPeek({ id: c.lead_id, business_name: c.business_name, city: c.city, phone: c.phone, attempt_count: 1 })
                      }
                      className="min-w-0 flex-1 truncate text-left text-ink hover:underline"
                    >
                      {c.business_name}
                      {c.next_at && <span className="text-muted">{`  next ${formatWhen(c.next_at)}`}</span>}
                    </button>
                    {c.pending ? (
                      <span className="text-xs text-faint">Saving</span>
                    ) : confirmDelete === c.id ? (
                      <span className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-sunken">
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDelete(null);
                            deleteCall(c.id, label);
                          }}
                          className="rounded-md bg-lost px-2 py-1 text-xs font-medium text-white"
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(c.id)} className="shrink-0 rounded-md px-2 py-1 text-xs text-faint hover:bg-sunken hover:text-lost">
                        Delete
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <p className="mt-8 hidden text-center text-xs text-faint md:block">
        Keys: up/down or j/k to move, Enter to log, c to call, space for details, / to search, u to undo, a to add a lead
      </p>

      {sheet && <OutcomeSheet lead={sheet} call={activeCall} onLog={(input) => logCall(sheet, input)} onClose={closeSheet} />}
      {peek && (
        <LeadPeek
          lead={peek}
          onClose={() => setPeek(null)}
          onCall={() => startCall(peek)}
          onLog={() => openLog(peek)}
        />
      )}
      {showEod && <EodReport name={callerName} stats={stats} called={called} demos={demos} onClose={() => setShowEod(false)} />}
      {showAdd && (
        <QuickAdd
          assignTo={callerId}
          onClose={() => setShowAdd(false)}
          onAdded={(_id, existing) => {
            setShowAdd(false);
            pushToast({ id: `add-${_id}`, text: existing ? "Already in the list, moved to Due now" : "Added to Due now", tone: "ok" }, 3000);
            reload();
          }}
        />
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-sheet-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "bg-lost text-white" : "bg-ink text-white"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.text}</p>
              {t.detail && <p className="truncate text-xs opacity-70">{t.detail}</p>}
            </div>
            {t.undo && (
              <button
                type="button"
                onClick={() => {
                  t.undo?.();
                  setToasts((l) => l.filter((x) => x.id !== t.id));
                }}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
              >
                Undo
              </button>
            )}
            {t.retry && (
              <button
                type="button"
                onClick={() => {
                  t.retry?.();
                  setToasts((l) => l.filter((x) => x.id !== t.id));
                }}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
              >
                Retry
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function QueueItem({
  row,
  selected,
  now,
  sod,
  refCb,
  onSelect,
  onPeek,
  onCall,
  onLog,
}: {
  row: QueueRow;
  selected: boolean;
  now: number;
  sod: number;
  refCb: (el: HTMLLIElement | null) => void;
  onSelect: () => void;
  onPeek: () => void;
  onCall: () => void;
  onLog: () => void;
}) {
  const due = row.due_at ? new Date(row.due_at) : null;
  const overdue = due && due.getTime() < sod;
  const later = due && due.getTime() > now;
  const tone = outcomeTone(row.last_outcome);

  return (
    <li
      ref={refCb}
      onMouseEnter={onSelect}
      className={`flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 ${selected ? "bg-sunken" : ""}`}
    >
      <button type="button" onClick={onPeek} className="min-w-0 flex-1 text-left">
        <p className="flex items-baseline gap-2">
          <span className="truncate font-medium text-ink">{row.business_name}</span>
          {row.city && <span className="hidden shrink-0 text-sm text-faint sm:inline">{row.city}</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          {due && (
            <span className={`font-medium ${overdue ? "text-lost" : "text-amber"}`}>
              {overdue ? `Overdue, was ${formatWhen(due)}` : later ? `At ${formatTime(due)}` : `Due ${formatTime(due)}`}
            </span>
          )}
          {row.last_outcome && (
            <span className={`rounded-md px-1.5 py-px text-xs font-medium ${tone.soft}`}>{outcomeLabel(row.last_outcome)}</span>
          )}
          {row.last_called_at && <span className="text-faint">{formatAgo(row.last_called_at)}</span>}
          {row.attempt_count > 0 && <span className="text-faint">{`try ${row.attempt_count + 1}`}</span>}
          {(row.due_note || (row.last_note && row.last_note !== outcomeLabel(row.last_outcome))) && (
            <span className="min-w-0 truncate text-muted">{row.due_note || row.last_note}</span>
          )}
          {!row.last_outcome && !due && row.city && <span className="text-faint sm:hidden">{row.city}</span>}
        </p>
      </button>
      <button type="button" onClick={onLog} className="hidden shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-line hover:text-ink sm:block">
        Log
      </button>
      <a
        href={`tel:${row.phone}`}
        onClick={onCall}
        className="shrink-0 rounded-xl bg-call px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-95"
        aria-label={`Call ${row.business_name}`}
      >
        Call
      </a>
    </li>
  );
}
