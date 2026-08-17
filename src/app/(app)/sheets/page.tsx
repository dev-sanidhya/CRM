import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { SheetImportRow } from "@/components/SheetImportRow";
import { PullForm } from "./PullForm";

export default async function SheetsPage() {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [{ data: recentImports }, { data: leadRows }] = await Promise.all([
    supabase
      .from("sheet_imports")
      .select("id, sheet_url, imported_at, row_count, new_lead_count, updated_lead_count, imported_by, sheet_layouts:layout_id(label)")
      .order("imported_at", { ascending: false })
      .limit(50),
    supabase.from("leads").select("sheet_import_id"),
  ]);

  // Live count of leads still attached to each import — what actually gets
  // removed if that pull is deleted, which can drift from the historical
  // new/updated counts at pull time (leads move between imports on re-pull).
  const currentCounts = new Map<string, number>();
  for (const row of leadRows ?? []) {
    if (row.sheet_import_id) {
      currentCounts.set(row.sheet_import_id, (currentCounts.get(row.sheet_import_id) ?? 0) + 1);
    }
  }

  const isFounder = profile?.role === "founder";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display mb-2 text-2xl font-semibold tracking-tight text-zinc-900">Pull from Sheet</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Paste the day&apos;s Google Sheet link. Leads are matched by phone number, so
        re-pulling the same sheet — or a new sheet with a repeated lead — updates
        the existing record instead of duplicating it. Unrecognized column layouts
        are mapped automatically.
      </p>

      <PullForm />

      {recentImports && recentImports.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {isFounder ? "All data sources" : "Recent pulls"}
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            Every sheet ever pulled in, and how many leads currently on file came
            from each one. {isFounder ? "You can delete any of these." : "You can delete pulls you made yourself."}
          </p>
          <ul className="space-y-2">
            {recentImports.map((imp) => (
              <SheetImportRow
                key={imp.id}
                id={imp.id}
                sheetUrl={imp.sheet_url}
                importedAt={imp.imported_at}
                layoutLabel={(imp.sheet_layouts as unknown as { label: string } | null)?.label ?? "Unknown layout"}
                newCount={imp.new_lead_count}
                updatedCount={imp.updated_lead_count}
                currentCount={currentCounts.get(imp.id) ?? 0}
                canDelete={isFounder || imp.imported_by === user.id}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
