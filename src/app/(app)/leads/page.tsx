import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { StagePill } from "@/components/StagePill";
import type { Stage } from "@/lib/stages";

export default async function LeadsPage() {
  const { profile } = await getCurrentUserAndProfile();
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("id, business_name, phone, city, stage, assigned_to, updated_at, profiles:assigned_to(name)")
    .order("updated_at", { ascending: false });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">
          {profile?.role === "founder" ? "All Leads" : "My Leads"}
        </h1>
        <span className="text-sm text-neutral-500">
          {leads?.length ?? 0} lead{leads?.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        {!leads || leads.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">
            No leads yet. {profile?.role === "founder" && "Pull a sheet to get started."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-3 font-medium">Business</th>
                <th className="px-5 py-3 font-medium">City</th>
                <th className="px-5 py-3 font-medium">Stage</th>
                {profile?.role === "founder" && (
                  <th className="px-5 py-3 font-medium">Assigned to</th>
                )}
                <th className="px-5 py-3 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="transition hover:bg-neutral-50">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {lead.business_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-600">{lead.city ?? "—"}</td>
                  <td className="px-5 py-3.5">
                    <StagePill stage={lead.stage as Stage} />
                  </td>
                  {profile?.role === "founder" && (
                    <td className="px-5 py-3.5 text-neutral-600">
                      {(lead.profiles as unknown as { name: string } | null)?.name ?? "Unassigned"}
                    </td>
                  )}
                  <td className="px-5 py-3.5 text-neutral-600">{lead.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
