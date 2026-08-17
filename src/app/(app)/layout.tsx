import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
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
    ...(profile.role === "founder"
      ? [{ href: "/sheets", label: "Pull Sheet" }]
      : []),
  ];

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white px-4 py-6">
        <div className="mb-8 px-2 text-lg font-semibold text-neutral-900">
          Lead CRM
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 border-t border-neutral-200 pt-4 px-2">
          <p className="text-sm font-medium text-neutral-900">{profile.name}</p>
          <p className="mb-3 text-xs capitalize text-neutral-500">
            {profile.role}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
