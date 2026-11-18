import { STAGE_LABELS, type Stage } from "@/lib/stages";
import { formatWhen } from "@/lib/time";

export type HistoryChanges = Record<string, [unknown, unknown]>;

const FIELD_LABELS: Record<string, string> = {
  business_name: "Name",
  phone: "Phone",
  city: "City",
  website: "Website",
  stage: "Stage",
  score: "Score",
  assigned_to: "Assigned to",
  category: "List",
  details_sent_at: "Deck sent",
  closed_at: "Closed",
  closed_reason: "Closed because",
  extra_fields: "Sheet details",
  sheet_import_id: "Import",
};

const SOURCE_LABELS: Record<string, string> = {
  call: "from a call",
  import: "from a sheet import",
  added_by_hand: "added by hand",
  edit: "edited",
};

export function sourceLabel(source: string | null | undefined): string {
  return SOURCE_LABELS[source ?? ""] ?? source ?? "";
}

/**
 * One readable line per changed field, e.g. "Stage: Tried to Spoke".
 * `names` maps profile ids and category keys to display names.
 */
export function describeChanges(changes: HistoryChanges | null | undefined, names: Record<string, string> = {}): string[] {
  if (!changes) return [];
  const out: string[] = [];
  for (const [field, pair] of Object.entries(changes)) {
    const [before, after] = pair ?? [null, null];
    const label = FIELD_LABELS[field] ?? field.replace(/_/g, " ");
    const show = (v: unknown): string => {
      if (v === null || v === undefined || v === "") return "empty";
      if (field === "stage") return STAGE_LABELS[v as Stage] ?? String(v);
      if (field === "assigned_to" || field === "category") return names[String(v)] ?? String(v);
      if (field === "closed_reason") return String(v).replace(/_/g, " ");
      return String(v);
    };
    if (field === "extra_fields") {
      out.push("Sheet details updated");
    } else if (field === "sheet_import_id") {
      out.push(before ? "Re-imported from a newer sheet" : "Linked to an import");
    } else if (field === "details_sent_at") {
      out.push(after ? `Deck marked sent ${formatWhen(String(after))}` : "Deck sent mark removed");
    } else if (field === "closed_at") {
      out.push(after ? "Closed" : "Reopened");
    } else {
      out.push(`${label}: ${show(before)} to ${show(after)}`);
    }
  }
  return out;
}
