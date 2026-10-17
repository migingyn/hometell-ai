// Database helpers for checks. Server only. Owner: Fullstack.
import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "node:crypto";
import type { Check, CheckPatch, CheckWithClient, HeartbeatEvent } from "@/lib/types";
import { runLadderStep } from "@/lib/ladder";

export async function getCheckEvent(check: Check): Promise<HeartbeatEvent> {
  const { data, error } = await supabaseAdmin().from("events").select("*").eq("id", check.event_id).single();
  if (error) throw new Error(error.message);
  return data as HeartbeatEvent;
}

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
async function claimLadderStep(check: Check, token: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("checks")
    .update({ next_action_at: null, action_token: token, action_started_at: new Date().toISOString() })
    .eq("id", check.id)
    .eq("status", "no_answer")
    .eq("ladder_step", check.ladder_step)
    .eq("updated_at", check.updated_at)
    .is("action_token", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// Claims, runs, and saves one ladder step. Returns the updated check, or null if skipped.
export async function advanceCheck(check: CheckWithClient): Promise<Check | null> {
  if (check.status !== "no_answer" || check.ladder_step >= 4) return null;
  const event = await getCheckEvent(check);
  const token = randomUUID();
  if (!(await claimLadderStep(check, token))) return null;
  let patch: CheckPatch;
  try {
    patch = await runLadderStep(check, check.client, event);
  } catch {
    patch = { status: "needs_human", urgency: "urgent", flag_reason: "Follow-up action failed; coordinator review required", next_action_at: null };
  }
  const { data, error } = await supabaseAdmin().from("checks")
    .update({ ...patch, action_token: null, action_started_at: null })
    .eq("id", check.id).eq("status", "no_answer").eq("action_token", token).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data as Check | null;
}
