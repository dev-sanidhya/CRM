import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StagePill } from "@/components/StagePill";
import { LeadSearch } from "@/components/LeadSearch";
import { outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { formatAgo } from "@/lib/time";
import type { Stage } from "@/lib/stages";

const PAGE_SIZE = 50;

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "called", label: "Called" },
  { key: "fresh", label: "Not called" },
  { key: "demos", label: "Demos" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; view?: string }>;
}) {
  const [{ q = "", page: pageParam, view: viewParam }, { profile }] = await Promise.all([searchParams, getCurrentUserAndProfile()]);
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const view: View = (VIEWS.find((v) => v.key === viewParam)?.key ?? "open") as View;
  const from = (page - 1) * PAGE_SIZE;
  const isFounder = profile?.role === "founder";
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("id, business_name, phone, city, stage, attempt_count, last_called_at, last_outcome, last_note, profiles:assigned_to(name)", {
      count: "estimated",
    })
    .range(from, from + PAGE_SIZE - 1);

  if (view === "open") query = query.is("closed_at", null).not("stage", "in", "(won,lost)");
  if (view === "called") query = query.gt("attempt_count", 0);
  if (view === "fresh") query = query.eq("attempt_count", 0).is("closed_at", null);
  if (view === "demos") query = query.in("stage", ["meeting_booked", "proposal_sent", "won"]);
  if (view === "closed") query = query.or("closed_at.not.is.null,stage.in.(won,lost)");

  query =
    view === "called" || view === "closed"
      ? query.order("last_called_at", { ascending: false, nullsFirst: false })
      : query.order("updated_at", { ascending: false });

  const term = q.trim().replace(/[%_,()*]/g, "");
  if (term) {
    const digits = term.replace(/\D/g, "");
    query = query.or(
      digits.length >= 3
        ? `phone.ilike.*${digits}*,business_name.ilike.*${term}*`
        : `business_name.ilike.*${term}*,city.ilike.*${term}*`,
    );
  }

  const { data: leads, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (p: number, v: View = view) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (v !== "open") params.set("view", v);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  const back = encodeURIComponent(`/leads${qs(page)}`);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{isFounder ? "All leads" : "My leads"}</h1>
          <p className="text-sm text-muted">
            About {total.toLocaleString("en-IN")} lead{total === 1 ? "" : "s"}
            {q && <> matching &ldquo;{q}&rdquo;</>}
          </p>
        </div>
        <LeadSearch />
      </div>

      <nav className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1" aria-label="Filter leads">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/leads${qs(1, v.key)}`}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
              v.key === view ? "bg-ink text-white" : "text-muted hover:bg-surface hover:text-ink"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {!leads || leads.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted">
          {q ? "No leads match that search." : "Nothing here yet. Import a sheet to get started."}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
          <li className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_minmax(0,1.6fr)_8.5rem] gap-4 border-b border-line bg-sunken px-4 py-2 text-xs font-medium text-muted md:grid">
            <span>Business</span>
            <span>City</span>
            <span>Stage</span>
            <span>Last call</span>
            <span className="text-right">Phone</span>
          </li>
          {leads.map((lead) => {
            const tone = outcomeTone(lead.last_outcome);
            const owner = (lead.profiles as unknown as { name: string } | null)?.name;
            return (
              <li key={lead.id} className="border-b border-line last:border-0">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_minmax(0,1.6fr)_8.5rem]">
                  <Link href={`/leads/${lead.id}?from=${back}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                    {lead.business_name}
                    {isFounder && <span className="ml-2 text-xs font-normal text-faint">{owner ?? "Unassigned"}</span>}
                  </Link>
                  <span className="hidden truncate text-sm text-muted md:block">{lead.city ?? ""}</span>
                  <span className="justify-self-end md:justify-self-start">
                    <StagePill stage={lead.stage as Stage} />
                  </span>
                  <span className="col-span-2 flex min-w-0 items-center gap-2 text-sm md:col-span-1">
                    {lead.last_outcome ? (
                      <>
                        <span className={`shrink-0 rounded-md px-1.5 py-px text-xs font-medium ${tone.soft}`}>{outcomeLabel(lead.last_outcome)}</span>
                        <span className="truncate text-faint">
                          {lead.last_called_at ? formatAgo(lead.last_called_at) : ""}
                          {lead.attempt_count > 1 ? `, ${lead.attempt_count} calls` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-faint">{lead.city && <span className="md:hidden">{lead.city}  </span>}Not called</span>
                    )}
                  </span>
                  <a href={`tel:${lead.phone}`} className="hidden text-right text-sm tabular-nums text-muted hover:text-call md:block">
                    {lead.phone}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Link
            href={`/leads${qs(Math.max(1, page - 1))}`}
            aria-disabled={page === 1}
            className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-ink ${page === 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            Previous
          </Link>
          <span className="text-sm tabular-nums text-muted">
            Page {page} of {totalPages}
          </span>
          <Link
            href={`/leads${qs(Math.min(totalPages, page + 1))}`}
            aria-disabled={page >= totalPages}
            className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-ink ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}
