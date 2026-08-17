import { redirect } from "next/navigation";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createProfile } from "./actions";

export default async function OnboardingPage() {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user) redirect("/login");
  if (profile) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold text-neutral-900">
          Welcome
        </h1>
        <p className="mb-8 text-center text-sm text-neutral-500">
          One quick step — what should we call you?
        </p>
        <form
          action={createProfile}
          className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <label className="mb-1.5 block text-sm font-medium text-neutral-700">
            Your name
          </label>
          <input
            name="name"
            required
            placeholder="Full name"
            className="mb-4 w-full rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-neutral-900 px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
