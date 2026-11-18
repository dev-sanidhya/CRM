"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type CategoryOption = { key: string; label: string };

/**
 * All / Influencer management / Partnership calls. The choice is remembered
 * (cookie) so Today, Leads and Activity stay on the same list.
 */
export function CategoryTabs({
  categories,
  current,
  counts,
  keepParams = [],
}: {
  categories: CategoryOption[];
  current: string;
  counts?: Record<string, number>;
  keepParams?: string[];
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const options = [{ key: "all", label: "All lists" }, ...categories];
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  const hrefFor = (key: string) => {
    const params = new URLSearchParams();
    for (const k of keepParams) {
      const v = search.get(k);
      if (v) params.set(k, v);
    }
    params.set("cat", key);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Lead list">
      {options.map((o) => {
        const active = o.key === current;
        const n = o.key === "all" ? total : counts?.[o.key] ?? (counts ? 0 : undefined);
        return (
          <Link
            key={o.key}
            href={hrefFor(o.key)}
            onClick={() => {
              document.cookie = `crm.cat=${o.key}; path=/; max-age=31536000; samesite=lax`;
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-ink text-white" : "border border-line bg-surface text-muted hover:border-ink hover:text-ink"
            }`}
          >
            {o.label}
            {n !== undefined && <span className={`tabular-nums ${active ? "text-white/70" : "text-faint"}`}>{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function CategoryTag({ label }: { label: string }) {
  return <span className="rounded-md border border-line px-1.5 py-px text-[11px] font-medium text-muted">{label}</span>;
}
