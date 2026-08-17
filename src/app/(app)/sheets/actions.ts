"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildExportUrl, headerSignature, normalizePhone, parseSheetUrl } from "@/lib/sheets";

type ColumnMapping = {
  business_name?: string;
  phone?: string;
  city?: string;
  website?: string;
  score?: string;
  status?: string;
  follow_up_date?: string;
};

export type PullResult =
  | { ok: true; newCount: number; updatedCount: number; skipped: number; total: number; layoutLabel: string }
  | { ok: false; error: string; headers?: string[] };

export async function pullSheet(_prev: PullResult | null, formData: FormData): Promise<PullResult> {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { ok: false, error: "Paste a sheet link first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let sheetId: string, gid: string | null;
  try {
    ({ sheetId, gid } = parseSheetUrl(url));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const exportUrl = buildExportUrl(sheetId, gid);
  const res = await fetch(exportUrl);
  if (!res.ok) {
    return {
      ok: false,
      error: `Couldn't read that sheet (${res.status}). Make sure it's shared as "anyone with the link can view".`,
    };
  }
  const csvText = await res.text();

  // Parse without assuming row 0 is the header row — several of the daily
  // sheets have a merged title row above the real headers (e.g. "Aperture —
  // India Interior Designer Call Sheet | List F"). Scan the first few rows
  // for one whose columns match a known layout signature.
  const rawParsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
  const rawRows = rawParsed.data;
  if (rawRows.length === 0) {
    return { ok: false, error: "That sheet looks empty." };
  }

  const { data: allLayouts } = await supabase
    .from("sheet_layouts")
    .select("id, label, column_mapping, status_map, header_signature");

  let headerRowIndex = -1;
  let layout: { id: string; label: string; column_mapping: ColumnMapping; status_map: Record<string, string> } | null = null;
  for (let i = 0; i < Math.min(5, rawRows.length); i++) {
    const signature = headerSignature(rawRows[i]);
    const match = allLayouts?.find((l) => l.header_signature === signature);
    if (match) {
      headerRowIndex = i;
      layout = match;
      break;
    }
  }

  if (!layout) {
    return {
      ok: false,
      error:
        "This sheet's columns don't match any known layout yet. It needs a one-time mapping added before it can be pulled.",
      headers: rawRows.slice(0, 3).map((r) => r.join(" | ")),
    };
  }

  const headers = rawRows[headerRowIndex];
  const rows: Record<string, string>[] = rawRows.slice(headerRowIndex + 1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });

  if (rows.length === 0) {
    return { ok: false, error: "Found the header row but no data rows below it." };
  }

  const mapping = layout.column_mapping as ColumnMapping;
  const statusMap = layout.status_map as Record<string, string>;
  const fixedHeaders = new Set(
    [mapping.business_name, mapping.phone, mapping.city, mapping.website, mapping.score].filter(
      Boolean,
    ) as string[],
  );

  let skipped = 0;
  const payloadRows: Record<string, unknown>[] = [];

  for (const row of rows) {
    const phoneRaw = mapping.phone ? row[mapping.phone] : "";
    const phone = normalizePhone(phoneRaw ?? "");
    const businessName = mapping.business_name ? row[mapping.business_name]?.trim() : "";
    if (!phone || !businessName) {
      skipped++;
      continue;
    }

    const rawStatus = mapping.status ? (row[mapping.status] ?? "").trim() : "";
    const stage = statusMap[rawStatus] ?? "new";
    const city = mapping.city ? row[mapping.city]?.trim() || null : null;
    const website = mapping.website ? row[mapping.website]?.trim() || null : null;
    const scoreRaw = mapping.score ? row[mapping.score] : undefined;
    const score = scoreRaw && !isNaN(Number(scoreRaw)) ? Number(scoreRaw) : null;

    const extraFields: Record<string, string> = {};
    for (const h of headers) {
      if (fixedHeaders.has(h)) continue;
      const v = row[h]?.trim();
      if (v) extraFields[h] = v;
    }

    let followUpDate: string | null = null;
    let followUpNote: string | null = null;
    if (mapping.follow_up_date) {
      const rawDate = row[mapping.follow_up_date]?.trim();
      if (rawDate) {
        const parsedDate = new Date(rawDate);
        if (!isNaN(parsedDate.getTime())) {
          followUpDate = parsedDate.toISOString();
          followUpNote = "Follow-up imported from sheet";
        }
      }
    }

    payloadRows.push({
      business_name: businessName,
      phone,
      city,
      website,
      stage,
      score,
      extra_fields: extraFields,
      follow_up_date: followUpDate,
      follow_up_note: followUpNote,
    });
  }

  // Single round trip: the import_leads RPC does the dedup-upsert + reminder
  // creation + sheet_imports logging server-side (security definer), which
  // is also what lets callers pull sheets without needing RLS visibility
  // into every other lead for the dedup check.
  const { data: result, error } = await supabase.rpc("import_leads", {
    p_layout_id: layout.id,
    p_rows: payloadRows,
    p_sheet_url: url,
    p_sheet_tab: gid,
  });

  if (error) {
    return { ok: false, error: `Import failed: ${error.message}` };
  }

  revalidatePath("/leads");
  revalidatePath("/reminders");
  revalidatePath("/sheets");

  return {
    ok: true,
    newCount: result.new_count,
    updatedCount: result.updated_count,
    skipped,
    total: rows.length,
    layoutLabel: layout.label,
  };
}

export async function deleteSheetImport(importId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_sheet_import", { p_import_id: importId });

  revalidatePath("/leads");
  revalidatePath("/reminders");
  revalidatePath("/sheets");

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, deletedCount: data as number };
}
