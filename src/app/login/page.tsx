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
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-foreground shadow-lg shadow-accent/25">
            L
          </div>
        </div>
        <h1 className="font-display mb-1 text-center text-3xl font-semibold tracking-tight text-zinc-900">
          Lead CRM
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-500">Sign in to continue.</p>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl shadow-zinc-900/5"
        >
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">
            Username or email
          </label>
          <input
            type="text"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com"
            className="mb-4 w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-5 w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-xl bg-accent px-3.5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
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
