import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { SheetImportRow } from "@/components/SheetImportRow";
import { PullForm } from "./PullForm";

export default async function SheetsPage() {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [{ data: imports }, { data: countRows }] = await Promise.all([
    supabase
      .from("sheet_imports")
      .select("id, sheet_url, imported_at, row_count, new_lead_count, updated_lead_count, imported_by, sheet_layouts:layout_id(label)")
      .order("imported_at", { ascending: false })
      .limit(50),
    supabase.rpc("get_import_lead_counts"),
  ]);

  const counts = new Map<string, number>(((countRows as { import_id: string; n: number }[]) ?? []).map((r) => [r.import_id, Number(r.n)]));
  const isFounder = profile?.role === "founder";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Import leads</h1>
      <p className="mb-5 mt-1 max-w-prose text-sm text-muted">
        Paste a Google Sheet link or drop a spreadsheet. Any column layout works. Leads are matched by phone number, so
        importing the same lead twice updates it instead of making a copy. New leads show up on Today under Not called yet.
      </p>

      <PullForm />

      {imports && imports.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[15px] font-semibold text-ink">{isFounder ? "All imports" : "Imports"}</h2>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {imports.map((imp) => (
              <SheetImportRow
                key={imp.id}
                id={imp.id}
                sheetUrl={imp.sheet_url}
                importedAt={imp.imported_at}
                layoutLabel={(imp.sheet_layouts as unknown as { label: string } | null)?.label ?? "Unknown layout"}
                newCount={imp.new_lead_count}
                updatedCount={imp.updated_lead_count}
                currentCount={counts.get(imp.id) ?? 0}
                canDelete={isFounder || imp.imported_by === user.id}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
