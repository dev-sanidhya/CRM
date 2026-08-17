import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StagePill } from "@/components/StagePill";
import { LeadSearch } from "@/components/LeadSearch";
import { CallerStatsWidget } from "@/components/CallerStatsWidget";
import { getCallerStats } from "@/lib/callerStats";
import type { Stage } from "@/lib/stages";

const PAGE_SIZE = 30;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { user, profile } = await getCurrentUserAndProfile();
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("id, business_name, phone, city, stage, assigned_to, updated_at, profiles:assigned_to(name)", {
      count: "exact",
    })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (q.trim()) {
    const term = q.trim().replace(/[%_]/g, "");
    query = query.or(`business_name.ilike.%${term}%,phone.ilike.%${term}%,city.ilike.%${term}%`);
  }

  const { data: leads, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const stats =
    profile?.role === "caller" && user ? await getCallerStats(supabase, user.id) : null;

  const qsFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div>
      {stats && <CallerStatsWidget stats={stats} />}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-900">
            {profile?.role === "founder" ? "All Leads" : "My Leads"}
          </h1>
          <p className="text-sm text-zinc-500">
            {count ?? 0} lead{count === 1 ? "" : "s"}
            {q && <> matching &ldquo;{q}&rdquo;</>}
          </p>
        </div>
        <LeadSearch />
      </div>

      {!leads || leads.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 shadow-sm">
          {q ? "No leads match that search." : "No leads yet. Pull a sheet to get started."}
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-2 md:hidden">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <Link href={`/leads/${lead.id}`} className="mb-1.5 flex items-start justify-between gap-2">
                  <span className="font-medium text-zinc-900">{lead.business_name}</span>
                  <StagePill stage={lead.stage as Stage} />
                </Link>
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>
                    {lead.city ?? "—"}
                    {profile?.role === "founder" &&
                      ` · ${(lead.profiles as unknown as { name: string } | null)?.name ?? "Unassigned"}`}
                  </span>
                  <a href={`tel:${lead.phone}`} className="font-mono text-accent">
                    {lead.phone}
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Business</th>
                  <th className="px-5 py-3 font-semibold">City</th>
                  <th className="px-5 py-3 font-semibold">Stage</th>
                  {profile?.role === "founder" && (
                    <th className="px-5 py-3 font-semibold">Assigned to</th>
                  )}
                  <th className="px-5 py-3 font-semibold">Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className="transition hover:bg-zinc-50">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium text-zinc-900 hover:text-accent"
                      >
                        {lead.business_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-zinc-600">{lead.city ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <StagePill stage={lead.stage as Stage} />
                    </td>
                    {profile?.role === "founder" && (
                      <td className="px-5 py-3.5 text-zinc-600">
                        {(lead.profiles as unknown as { name: string } | null)?.name ?? "Unassigned"}
                      </td>
                    )}
                    <td className="px-5 py-3.5">
                      <a
                        href={`tel:${lead.phone}`}
                        className="font-mono text-xs text-zinc-600 hover:text-accent"
                      >
                        {lead.phone}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link
            href={`/leads${qsFor(Math.max(1, page - 1))}`}
            aria-disabled={page === 1}
            className={`rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 ${
              page === 1 ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Previous
          </Link>
          <span className="text-xs text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <Link
            href={`/leads${qsFor(Math.min(totalPages, page + 1))}`}
            aria-disabled={page === totalPages}
            className={`rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 ${
              page === totalPages ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}
