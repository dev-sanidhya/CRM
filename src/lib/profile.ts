import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  name: string;
  role: "founder" | "caller";
};

/**
 * Who is signed in, once per request. The layout and the page both need
 * this; `cache` makes the second call free instead of another two network
 * trips. `getClaims` verifies the session token locally (asymmetric JWT
 * signing keys), so it does not call the Auth server on every navigation.
 */
export const getCurrentUserAndProfile = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", userId)
    .maybeSingle();

  return { user: { id: userId }, profile: profile as Profile | null };
});
