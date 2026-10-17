// Database helpers for checks. Server only. Owner: Fullstack.
import { supabaseAdmin } from "@/lib/supabase";
import type { Check, CheckPatch, CheckWithClient } from "@/lib/types";
import { runLadderStep } from "@/lib/ladder";

export async function getCheckWithClient(id: string): Promise<CheckWithClient | null> {
  const { data, error } = await supabaseAdmin()
    .from("checks")
    .select("*, client:clients(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CheckWithClient | null;
}

export async function updateCheck(id: string, patch: CheckPatch): Promise<Check> {
  const { data, error } = await supabaseAdmin()
    .from("checks")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Check;
}

// Claims the next ladder step so two ticks never run the same step twice.
// Returns false if another request already moved this check.
async function claimLadderStep(check: Check): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("checks")
    .update({ next_action_at: null })
    .eq("id", check.id)
    .eq("status", "no_answer")
    .eq("ladder_step", check.ladder_step)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// Claims, runs, and saves one ladder step. Returns the updated check, or null if skipped.
export async function advanceCheck(check: CheckWithClient): Promise<Check | null> {
  if (!(await claimLadderStep(check))) return null;
  const patch = await runLadderStep(check, check.client);
  return updateCheck(check.id, patch);
}
