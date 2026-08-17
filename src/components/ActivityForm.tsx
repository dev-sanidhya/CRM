"use client";

import { useRef, useState } from "react";
import { addActivity } from "@/app/(app)/leads/[id]/actions";

export function ActivityForm({ leadId }: { leadId: string }) {
  const [type, setType] = useState("call");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await addActivity(leadId, formData);
        formRef.current?.reset();
        setType("call");
      }}
      className="mb-5 space-y-2"
    >
      <div className="flex gap-2">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="linkedin">LinkedIn</option>
          <option value="note">Note</option>
        </select>
        {type === "call" && (
          <select
            name="answered"
            defaultValue=""
            className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Outcome…</option>
            <option value="true">Answered</option>
            <option value="false">No answer</option>
          </select>
        )}
      </div>
      <textarea
        name="summary"
        required
        placeholder="What happened?"
        rows={2}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="submit"
        className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground shadow-sm transition hover:opacity-90"
      >
        Log activity
      </button>
    </form>
  );
}
