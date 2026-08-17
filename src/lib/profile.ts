import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  name: string;
  role: "founder" | "caller";
};

export async function getCurrentUserAndProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile: profile as Profile | null };
}
