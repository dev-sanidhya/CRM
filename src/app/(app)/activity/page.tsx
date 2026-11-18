import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { getCategories, resolveCategory } from "@/lib/categories";
import { CategoryTabs } from "@/components/CategoryTabs";
import { ActivityFeed, type Feed } from "@/components/activity/ActivityFeed";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ cat?: string; caller?: string }> }) {
  const [{ user, profile }, sp, categories] = await Promise.all([getCurrentUserAndProfile(), searchParams, getCategories()]);
  if (!user || !profile) redirect("/login");
  const isFounder = profile.role === "founder";
  const category = await resolveCategory(sp.cat, categories);

  const supabase = await createClient();
  const callers = isFounder
    ? ((await supabase.from("profiles").select("id, name").order("name")).data ?? [])
    : [];
  const caller = isFounder ? (callers.some((c) => c.id === sp.caller) ? sp.caller! : "all") : user.id;

  const { data, error } = await supabase.rpc("get_activity_feed", {
    p_before: null,
    p_days: 3,
    p_caller: caller === "all" ? null : caller,
    p_category: category === "all" ? null : category,
    p_query: null,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Activity</h1>
      <p className="mb-4 mt-1 text-sm text-muted">Every call, note and change to a lead, day by day.</p>
      <div className="mb-4">
        <CategoryTabs categories={categories} current={category} keepParams={["caller"]} />
      </div>
      {error ? (
        <p className="rounded-2xl border border-lost/30 bg-lost-soft p-5 text-sm text-lost">Could not load the history: {error.message}</p>
      ) : (
        <ActivityFeed
          key={`${category}-${caller}`}
          initial={(data as Feed) ?? { days: [], has_more: false }}
          categories={categories}
          category={category}
          callers={callers}
          caller={caller}
          isFounder={isFounder}
        />
      )}
    </div>
  );
}
