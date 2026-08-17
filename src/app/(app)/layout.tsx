import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { Sidebar } from "@/components/Sidebar";
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
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <Sidebar navItems={navItems} profile={profile} signOutAction={signOut} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
