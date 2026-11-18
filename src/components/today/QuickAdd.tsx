"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/sheets";

/** Add one lead by hand: a referral, an inbound call, a number from WhatsApp. */
export function QuickAdd({
  assignTo,
  categories,
  defaultCategory,
  onAdded,
  onClose,
}: {
  assignTo: string;
  categories: { key: string; label: string }[];
  defaultCategory: string;
  onAdded: (leadId: string, existing: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!name.trim() || normalized.replace(/\D/g, "").length < 10) {
      setError("Add a name and a full phone number.");
      return;
    }
    setSaving(true);
    setError("");
    const { data, error: rpcError } = await createClient().rpc("quick_add_lead", {
      p_name: name.trim(),
      p_phone: normalized,
      p_city: city.trim() || null,
      p_assign: assignTo,
      p_category: category,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onAdded(data.id, data.existing);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal aria-label="Add a lead">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/25" />
      <form onSubmit={submit} className="animate-sheet-in relative w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <p className="mb-4 text-[17px] font-semibold text-ink">Add a lead</p>
        <div className="space-y-2.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Business name"
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-ink"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            inputMode="tel"
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-ink"
          />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City (optional)"
            className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-ink"
          />
          {categories.length > 1 && (
            <div className="flex gap-1.5" role="radiogroup" aria-label="List">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={category === c.key}
                  onClick={() => setCategory(c.key)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
                    category === c.key ? "bg-ink text-white" : "border border-line text-muted hover:border-ink"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-lost">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="rounded-xl bg-sunken px-4 py-2.5 text-sm font-semibold text-ink hover:bg-line">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add to today's list"}
          </button>
        </div>
      </form>
    </div>
  );
}
