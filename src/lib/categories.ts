import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type Category = { key: string; label: string };

/** The lists being dialled (Influencer management, Partnership calls...). */
export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("lead_categories").select("key, label").order("sort");
  return (data as Category[]) ?? [];
});

export const CATEGORY_COOKIE = "crm.cat";

/**
 * The category the person is working in: from the URL when given, else the
 * last one they picked (cookie), else all. "all" means no filter.
 */
export async function resolveCategory(param: string | undefined, categories: Category[]): Promise<string> {
  const valid = (v: string | undefined) => v === "all" || categories.some((c) => c.key === v);
  if (valid(param)) return param!;
  const saved = (await cookies()).get(CATEGORY_COOKIE)?.value;
  return valid(saved) ? saved! : "all";
}
