import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { Sidebar, type NavItem } from "@/components/Sidebar";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await getCurrentUserAndProfile();
  // Accounts are provisioned with a profile row up front, so a missing
  // profile means a login slipped through without one.
  if (!user || !profile) redirect("/login");

  const navItems: NavItem[] = [
    { href: "/today", label: "Today", icon: "today" },
    { href: "/leads", label: profile.role === "founder" ? "All leads" : "My leads", icon: "leads" },
    { href: "/sheets", label: "Import", icon: "import" },
    ...(profile.role === "founder" ? [{ href: "/team", label: "Team", icon: "team" } as NavItem] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-canvas md:flex-row">
      <Sidebar navItems={navItems} profile={profile} signOutAction={signOut} />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-4 sm:px-6 md:px-8 md:pb-10 md:pt-6">{children}</main>
    </div>
  );
}
