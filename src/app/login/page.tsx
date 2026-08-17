"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Accounts are plain email/password. A bare username (no "@") is treated as
// an internal login handle and mapped to a fixed local domain, so callers
// can sign in with something like "diksha" instead of a real email address.
function resolveIdentifier(input: string): string {
  const trimmed = input.trim();
  return trimmed.includes("@") ? trimmed : `${trimmed}@leadcrm.local`;
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: resolveIdentifier(identifier),
      password,
    });
    if (error) {
      setStatus("error");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold text-neutral-900">
          Lead CRM
        </h1>
        <p className="mb-8 text-center text-sm text-neutral-500">
          Sign in to continue.
        </p>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <label className="mb-1.5 block text-sm font-medium text-neutral-700">
            Username or email
          </label>
          <input
            type="text"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com"
            className="mb-4 w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
          <label className="mb-1.5 block text-sm font-medium text-neutral-700">
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-xl bg-neutral-900 px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {status === "loading" ? "Signing in…" : "Sign in"}
          </button>
          {status === "error" && (
            <p className="mt-3 text-center text-sm text-red-600">
              Wrong username/email or password.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
