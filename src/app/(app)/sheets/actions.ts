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

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = parsed.meta.fields ?? [];
  const rows = parsed.data;

  if (headers.length === 0 || rows.length === 0) {
    return { ok: false, error: "That sheet looks empty." };
  }

  const signature = headerSignature(headers);
  const { data: layout } = await supabase
    .from("sheet_layouts")
    .select("id, label, column_mapping, status_map")
    .eq("header_signature", signature)
    .maybeSingle();

  if (!layout) {
    return {
      ok: false,
      error:
        "This sheet's columns don't match any known layout yet. It needs a one-time mapping added before it can be pulled.",
      headers,
    };
  }

  const mapping = layout.column_mapping as ColumnMapping;
  const statusMap = layout.status_map as Record<string, string>;
  const fixedHeaders = new Set(
    [mapping.business_name, mapping.phone, mapping.city, mapping.website, mapping.score].filter(
      Boolean,
    ) as string[],
  );

  let newCount = 0;
  let updatedCount = 0;
  let skipped = 0;

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

    const { data: existing } = await supabase
      .from("leads")
      .select("id, assigned_to")
      .eq("phone", phone)
      .maybeSingle();

    let leadId: string;
    if (existing) {
      await supabase
        .from("leads")
        .update({ business_name: businessName, city, website, score, extra_fields: extraFields })
        .eq("id", existing.id);
      leadId = existing.id;
      updatedCount++;
    } else {
      const { data: inserted } = await supabase
        .from("leads")
        .insert({
          business_name: businessName,
          phone,
          city,
          website,
          stage,
          score,
          extra_fields: extraFields,
        })
        .select("id")
        .single();
      leadId = inserted!.id;
      newCount++;
    }

    if (mapping.follow_up_date) {
      const rawDate = row[mapping.follow_up_date]?.trim();
      if (rawDate) {
        const parsedDate = new Date(rawDate);
        if (!isNaN(parsedDate.getTime())) {
          await supabase.from("reminders").insert({
            lead_id: leadId,
            assigned_to: existing?.assigned_to ?? null,
            due_at: parsedDate.toISOString(),
            note: "Follow-up imported from sheet",
            source: "sheet_import",
          });
        }
      }
    }
  }

  await supabase.from("sheet_imports").insert({
    sheet_url: url,
    sheet_tab: gid,
    layout_id: layout.id,
    imported_by: user.id,
    row_count: rows.length,
    new_lead_count: newCount,
    updated_lead_count: updatedCount,
  });

  revalidatePath("/leads");
  revalidatePath("/reminders");

  return {
    ok: true,
    newCount,
    updatedCount,
    skipped,
    total: rows.length,
    layoutLabel: layout.label,
  };
}
