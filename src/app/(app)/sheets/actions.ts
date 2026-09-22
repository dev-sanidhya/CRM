"use server";

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildExportUrl, headerSignature, normalizePhone, parseSheetUrl } from "@/lib/sheets";
import { inferSheetMapping } from "@/lib/groq";

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

// How many leading rows to scan for a header row before giving up — real
// sheets show up with anywhere from zero to several title/subtitle/note
// rows stacked above the real headers (e.g. a sheet with a title, a
// description line, and a stats line before the header row).
const HEADER_SCAN_ROWS = 10;

// Shared by both the Google Sheet URL pull and the file-upload pull: takes
// already-parsed raw string rows (from CSV or from an Excel workbook) and
// runs the format-agnostic header detection + layout matching/inference +
// import RPC. `sourceLabel` is stored as sheet_imports.sheet_url — either
// the real Google Sheet link, or a `file:<name>` marker for uploads.
async function importRows(
  rawRows: string[][],
  sourceLabel: string,
  sheetTab: string | null,
): Promise<PullResult> {
  const filteredRows = rawRows
    .map((r) => r.map((c) => (c ?? "").toString()))
    .filter((r) => r.some((c) => c.trim()));

  if (filteredRows.length === 0) {
    return { ok: false, error: "That sheet looks empty." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: allLayouts } = await supabase
    .from("sheet_layouts")
    .select("id, label, column_mapping, status_map, header_signature");

  let headerRowIndex = -1;
  let layout: { id: string; label: string; column_mapping: ColumnMapping; status_map: Record<string, string> } | null = null;
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, filteredRows.length); i++) {
    const signature = headerSignature(filteredRows[i]);
    const match = allLayouts?.find((l) => l.header_signature === signature);
    if (match) {
      headerRowIndex = i;
      layout = match;
      break;
    }
  }

  if (!layout) {
    // Format-agnostic fallback: no exact match against a known layout, so
    // detect the likely header row (first row with several non-empty cells
    // — distinguishes a real header row from a one-cell title/subtitle row)
    // and ask Groq to map its columns to our schema. The result is cached
    // as a new sheet_layouts row keyed by this exact header signature, so
    // this format is instant and free on every future pull.
    let candidateIndex = -1;
    for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, filteredRows.length); i++) {
      if (filteredRows[i].filter((c) => c.trim()).length >= 3) {
        candidateIndex = i;
        break;
      }
    }
    if (candidateIndex === -1) candidateIndex = 0;

    const candidateHeaders = filteredRows[candidateIndex];
    const sampleRowRaw = filteredRows[candidateIndex + 1] ?? [];
    const sampleRow: Record<string, string> = {};
    candidateHeaders.forEach((h, idx) => {
      sampleRow[h] = sampleRowRaw[idx] ?? "";
    });

    const inferred = await inferSheetMapping(candidateHeaders, sampleRow);
    if (!inferred) {
      return {
        ok: false,
        error:
          "Couldn't automatically figure out this sheet's columns. Make sure it has clear headers for at least business name and phone.",
        headers: filteredRows.slice(0, 3).map((r) => r.join(" | ")),
      };
    }

    const signature = headerSignature(candidateHeaders);
    const { data: savedLayout, error: saveError } = await supabase
      .from("sheet_layouts")
      .upsert(
        {
          header_signature: signature,
          label: `Auto-detected (${candidateHeaders.slice(0, 3).join(", ")}…)`,
          column_mapping: inferred,
          status_map: {},
        },
        { onConflict: "header_signature" },
      )
      .select("id, label, column_mapping, status_map")
      .single();

    if (saveError || !savedLayout) {
      return {
        ok: false,
        error: `Detected a column mapping but couldn't save it: ${saveError?.message ?? "unknown error"}`,
      };
    }

    headerRowIndex = candidateIndex;
    layout = savedLayout;
  }

  const headers = filteredRows[headerRowIndex];
  const rows: Record<string, string>[] = filteredRows.slice(headerRowIndex + 1).map((r) => {
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
    p_sheet_url: sourceLabel,
    p_sheet_tab: sheetTab,
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

export async function pullSheet(_prev: PullResult | null, formData: FormData): Promise<PullResult> {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { ok: false, error: "Paste a sheet link first." };

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
  const rawRows = Papa.parse<string[]>(csvText, { skipEmptyLines: true }).data;

  return importRows(rawRows, url, gid);
}

// File-upload pull: lets anyone hand over a spreadsheet directly (.xlsx,
// .xls, .csv) instead of needing it published as a Google Sheet first.
// Goes through the same format-agnostic header detection and Groq mapping
// as a URL pull, so any lead sheet someone drops in — regardless of source
// or column layout — gets parsed the same way.
export async function pullFile(_prev: PullResult | null, formData: FormData): Promise<PullResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file first." };
  }

  const name = file.name.toLowerCase();
  let rawRows: string[][];

  try {
    if (name.endsWith(".csv")) {
      const text = await file.text();
      rawRows = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
    } else {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return { ok: false, error: "That workbook has no sheets." };
      const worksheet = workbook.Sheets[sheetName];
      rawRows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
      });
    }
  } catch (e) {
    return { ok: false, error: `Couldn't read that file: ${(e as Error).message}` };
  }

  return importRows(rawRows, `file:${file.name}`, null);
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
