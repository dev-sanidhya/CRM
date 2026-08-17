import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { NavLinks } from "@/components/NavLinks";
import { Avatar } from "@/components/Avatar";
import { signOut } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user) redirect("/login");
  // Accounts are provisioned with a profile row up front (no self-serve
  // signup for this 2-person tool) — a missing profile means a login
  // slipped through without one, so send back to sign-in rather than 404.
  if (!profile) redirect("/login");

  const navItems = [
    { href: "/leads", label: profile.role === "founder" ? "All Leads" : "My Leads" },
    { href: "/reminders", label: "Reminders" },
    { href: "/sheets", label: "Pull Sheet" },
    ...(profile.role === "founder" ? [{ href: "/team", label: "Team" }] : []),
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-4 py-6">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            L
          </div>
          <span className="text-base font-bold tracking-tight text-zinc-900">Lead CRM</span>
        </div>
        <NavLinks items={navItems} />
        <div className="mt-6 flex items-center gap-2.5 border-t border-zinc-200 pt-4 px-1">
          <Avatar name={profile.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900">{profile.name}</p>
            <p className="text-xs capitalize text-zinc-500">{profile.role}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10.5 11.5 14 8m0 0-3.5-3.5M14 8H6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
