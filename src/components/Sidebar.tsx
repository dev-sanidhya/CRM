"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { NavLinks } from "@/components/NavLinks";

type Profile = { name: string; role: string };

export function Sidebar({
  navItems,
  profile,
  signOutAction,
}: {
  navItems: { href: string; label: string }[];
  profile: Profile;
  signOutAction: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-black/10 bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            L
          </div>
          <span className="font-display text-base font-semibold tracking-tight">Lead CRM</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-1.5 text-sidebar-foreground/80 transition hover:bg-white/10"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 5.5h14M3 10h14M3 14.5h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Backdrop (mobile only, when drawer open) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar / drawer */}
      <aside
        className="fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-sidebar px-4 py-6 text-sidebar-foreground transition-transform duration-200 ease-out md:sticky md:top-0 md:h-screen md:!transform-none"
        style={{ transform: open ? "translateX(0)" : "translateX(-100%)" }}
      >
        <div className="mb-8 flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
              L
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">Lead CRM</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-1 text-sidebar-foreground/70 hover:bg-white/10 md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="m4 4 10 10M14 4 4 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div onClick={() => setOpen(false)}>
          <NavLinks items={navItems} />
        </div>
        <div className="mt-6 flex items-center gap-2.5 border-t border-white/10 pt-4 px-1">
          <Avatar name={profile.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile.name}</p>
            <p className="text-xs capitalize text-sidebar-foreground/60">{profile.role}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              className="rounded-lg p-1.5 text-sidebar-foreground/60 transition hover:bg-white/10 hover:text-sidebar-foreground"
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
    </>
  );
}
