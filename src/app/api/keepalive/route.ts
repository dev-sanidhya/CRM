import { createClient } from "@supabase/supabase-js";

// Daily cron target (see vercel.json) that keeps the free-tier Supabase
// project from pausing after 7 idle days, e.g. during leave or holidays.
// It also reports where this function ran and how long a database round
// trip takes from there, which is how the region move to Mumbai is measured.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await supabase.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
    samples.push(Math.round(performance.now() - t0));
  }
  const sorted = [...samples].sort((a, b) => a - b);

  return Response.json({
    ok: true,
    region: process.env.VERCEL_REGION ?? "local",
    db_round_trip_ms: { median: sorted[2], samples },
  });
}
