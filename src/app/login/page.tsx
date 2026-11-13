"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// A bare username (no "@") maps to an internal login domain, so callers can
// sign in with "diksha" instead of an email address.
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
    const { error } = await createClient().auth.signInWithPassword({
      email: resolveIdentifier(identifier),
      password,
    });
    if (error) {
      setStatus("error");
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <p className="text-2xl font-semibold tracking-tight text-ink">Aperture Calls</p>
        <p className="mb-6 mt-1 text-sm text-muted">Sign in to see today&apos;s list.</p>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-surface p-5">
          <label htmlFor="login-id" className="mb-1.5 block text-sm font-medium text-ink">
            Username or email
          </label>
          <input
            id="login-id"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="mb-4 w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
          />
          <label htmlFor="login-pw" className="mb-1.5 block text-sm font-medium text-ink">
            Password
          </label>
          <input
            id="login-pw"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-5 w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-xl bg-ink px-3.5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {status === "loading" ? "Signing in..." : "Sign in"}
          </button>
          {status === "error" && <p className="mt-3 text-sm text-lost">That username or password didn&apos;t match.</p>}
        </form>
      </div>
    </main>
  );
}
