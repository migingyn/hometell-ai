// Runs every due ladder step. The dashboard calls this every 5 seconds. Idempotent.
import { fail, ok } from "@/lib/api";
import { advanceCheck } from "@/lib/checks";
import { supabaseAdmin } from "@/lib/supabase";
import type { CheckWithClient } from "@/lib/types";

export async function POST() {
  try {
    const { data, error } = await supabaseAdmin()
      .from("checks")
      .select("*, client:clients(*)")
      .eq("status", "no_answer")
      .lte("next_action_at", new Date().toISOString());
    if (error) return fail(error.message, 500);

    let advanced = 0;
    for (const check of (data ?? []) as CheckWithClient[]) {
      if (await advanceCheck(check)) advanced++;
    }
    return ok({ due: data?.length ?? 0, advanced });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
