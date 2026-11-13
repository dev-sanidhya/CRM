"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/Avatar";

type Profile = { name: string; role: string };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

const ICONS = {
  today: (
    <path d="M4 6.5h12M4 10h12M4 13.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  ),
  leads: (
    <>
      <circle cx="8" cy="7" r="2.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 16c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 5.2a2.6 2.6 0 0 1 0 5M15 12.3c1.2.6 2 1.8 2.3 3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  import: (
    <path
      d="M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  team: (
    <path d="M4 16V9m4 7V5m4 11v-5m4 5V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  navItems,
  profile,
  signOutAction,
}: {
  navItems: NavItem[];
  profile: Profile;
  signOutAction: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-6 px-2">
          <p className="text-[15px] font-semibold text-ink">Aperture Calls</p>
          <p className="text-xs text-faint">Outbound desk</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-canvas text-ink" : "text-muted hover:bg-sunken hover:text-ink"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-1 pt-4">
          <Avatar name={profile.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{profile.name}</p>
            <p className="text-xs capitalize text-faint">{profile.role}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-1.5 text-faint transition-colors hover:bg-sunken hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
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

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur md:hidden">
        <p className="text-[15px] font-semibold text-ink">Aperture Calls</p>
        <div className="flex items-center gap-2">
          <Avatar name={profile.name} size={28} />
          <form action={signOutAction}>
            <button type="submit" className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-sunken">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? "text-ink" : "text-faint"
              }`}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
