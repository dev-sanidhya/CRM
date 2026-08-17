import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { PullForm } from "./PullForm";

export default async function SheetsPage() {
  const { profile } = await getCurrentUserAndProfile();
  if (profile?.role !== "founder") redirect("/leads");

  const supabase = await createClient();
  const { data: recentImports } = await supabase
    .from("sheet_imports")
    .select("id, sheet_url, imported_at, row_count, new_lead_count, updated_lead_count, sheet_layouts:layout_id(label)")
    .order("imported_at", { ascending: false })
    .limit(10);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Pull from Sheet</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Paste the day&apos;s Google Sheet link. Leads are matched by phone number, so
        re-pulling the same sheet — or a new sheet with a repeated lead — updates
        the existing record instead of duplicating it.
      </p>

      <PullForm />

      {recentImports && recentImports.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Recent pulls
          </h2>
          <ul className="space-y-2">
            {recentImports.map((imp) => (
              <li
                key={imp.id}
                className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm"
              >
                <p className="truncate font-medium text-neutral-800">{imp.sheet_url}</p>
                <p className="text-xs text-neutral-500">
                  {formatDateTime(imp.imported_at)}{" "}
                  · {(imp.sheet_layouts as unknown as { label: string } | null)?.label} ·{" "}
                  {imp.new_lead_count} new, {imp.updated_lead_count} updated
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
