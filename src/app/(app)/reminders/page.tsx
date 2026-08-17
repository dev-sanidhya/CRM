import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { ReminderRow } from "@/components/ReminderRow";

export default async function RemindersPage() {
  const { profile } = await getCurrentUserAndProfile();
  const supabase = await createClient();

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, due_at, note, leads:lead_id(id, business_name, stage), profiles:assigned_to(name)")
    .neq("status", "done")
    .order("due_at", { ascending: true });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const overdue = reminders?.filter((r) => new Date(r.due_at) < startOfToday) ?? [];
  const today =
    reminders?.filter(
      (r) => new Date(r.due_at) >= startOfToday && new Date(r.due_at) < startOfTomorrow,
    ) ?? [];
  const upcoming = reminders?.filter((r) => new Date(r.due_at) >= startOfTomorrow) ?? [];

  const isFounder = profile?.role === "founder";

  const sections = [
    { title: "Overdue", items: overdue },
    { title: "Today", items: today },
    { title: "Upcoming", items: upcoming },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Reminders</h1>
      {sections.every((s) => s.items.length === 0) && (
        <p className="text-sm text-neutral-500">
          Nothing pending — you&apos;re all caught up.
        </p>
      )}
      {sections.map(
        (section) =>
          section.items.length > 0 && (
            <div key={section.title} className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {section.title} ({section.items.length})
              </h2>
              <ul className="space-y-2">
                {section.items.map((r) => (
                  // @ts-expect-error -- Supabase join typing
                  <ReminderRow key={r.id} reminder={r} showAssignee={isFounder} />
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}
