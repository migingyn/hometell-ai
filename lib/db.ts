// Database reads shared by routes. Server only.
import { today } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase";
import type { Alert, Call, Client, CrisisRun, DailyEntry } from "@/lib/types";

// Throws on a Supabase error, else returns the data.
function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// Calls without the big raw payload, for API responses and events.
export type CallSummary = Omit<Call, "raw_json">;
const CALL_COLUMNS =
  "call_id, client_id, call_type, crisis_type, crisis_run_id, status, started_at, ended_at, duration_sec, " +
  "disconnection_reason, summary, sentiment, call_successful, feels_ok, danger_words_heard, med_taken, " +
  "allergy_item_mentioned, dose_question_asked, needs_nurse, needs_nurse_reason, new_personal_fact, answered_by, " +
  "pain_level, pain_location, sleep_quality, ate_and_drank, steady_on_feet, mood, new_swelling, crisis_status, " +
  "transcript, created_at, updated_at";

export function stripRaw(call: Call): CallSummary {
  const { raw_json: _raw, ...rest } = call;
  void _raw;
  return rest;
}

export async function listClients(): Promise<Client[]> {
  return must(await supabaseAdmin().from("clients").select("*").order("id"));
}

export async function getClient(id: number): Promise<Client | null> {
  return must(await supabaseAdmin().from("clients").select("*").eq("id", id).maybeSingle());
}

export async function todayEntries(): Promise<DailyEntry[]> {
  return must(await supabaseAdmin().from("daily_entries").select("*").eq("date", today()));
}

export async function getTodayEntry(clientId: number): Promise<DailyEntry | null> {
  return must(
    await supabaseAdmin().from("daily_entries").select("*").eq("client_id", clientId).eq("date", today()).maybeSingle(),
  );
}

export async function getCall(callId: string): Promise<Call | null> {
  return must(await supabaseAdmin().from("calls").select("*").eq("call_id", callId).maybeSingle());
}

// Newest first. clientId limits to one resident. since is an ISO timestamp.
export async function listCalls(opts: { clientId?: number; since?: string; limit?: number } = {}): Promise<CallSummary[]> {
  let q = supabaseAdmin().from("calls").select(CALL_COLUMNS).order("created_at", { ascending: false });
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.limit) q = q.limit(opts.limit);
  return must(await q) as unknown as CallSummary[];
}

export async function listRunCalls(runId: number): Promise<CallSummary[]> {
  return must(
    await supabaseAdmin()
      .from("calls")
      .select(CALL_COLUMNS)
      .eq("crisis_run_id", runId)
      .order("created_at", { ascending: false }),
  ) as unknown as CallSummary[];
}

export async function listOpenAlerts(clientId?: number): Promise<Alert[]> {
  let q = supabaseAdmin().from("alerts").select("*").is("acknowledged_at", null);
  if (clientId) q = q.eq("client_id", clientId);
  return must(await q);
}

export async function listAlertsForCalls(callIds: string[]): Promise<Alert[]> {
  if (!callIds.length) return [];
  return must(await supabaseAdmin().from("alerts").select("*").in("call_id", callIds));
}

export async function activeCrisisRun(): Promise<CrisisRun | null> {
  return must(
    await supabaseAdmin()
      .from("crisis_runs")
      .select("*")
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

// Lives in config.ts next to today(). Re-exported so existing imports keep working.
export { startOfToday } from "@/lib/config";
