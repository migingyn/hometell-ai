// Every 30 seconds: flag lines left open too long and crisis calls that never started.
// Before alerting on a real call it asks Retell for the call, so a missed webhook
// (ngrok restart, server down) is replayed instead of raising a false alarm.
// Started from instrumentation.ts. POST /api/watchdog/tick runs one pass by hand.
import { createAlert, crisisNoResponseMessage } from "@/lib/alerts";
import { config, NEVER_STARTED_MS } from "@/lib/config";
import { getClient } from "@/lib/db";
import { fetchRetellCall, isRealCallId } from "@/lib/retell";
import { supabaseAdmin } from "@/lib/supabase";
import type { Call } from "@/lib/types";
import { handleRetellEvent } from "@/lib/webhook";

const TICK_MS = 30 * 1000;
// call_analyzed usually lands within a minute of call_ended. Look it up after this long.
const ANALYSIS_LATE_MS = 2 * 60 * 1000;
// Stop looking up a call's analysis after this long.
const ANALYSIS_GIVE_UP_MS = 30 * 60 * 1000;

type Row = Pick<Call, "call_id" | "client_id" | "started_at" | "status">;

// Replays whatever Retell knows about a call through the webhook handler.
// Returns true if Retell says the call is no longer registered or ongoing.
async function syncFromRetell(callId: string): Promise<boolean> {
  let call;
  try {
    call = await fetchRetellCall(callId);
  } catch (e) {
    console.error(`[watchdog] Retell lookup ${callId} failed`, e instanceof Error ? e.message : e);
    return false;
  }
  if (!call || call.call_status === "registered") return false;

  if (call.start_timestamp) await handleRetellEvent({ event: "call_started", call });
  if (call.call_status === "ongoing") return false;

  // not_connected and error calls often have no reason. Treat them as a failed dial.
  const ended = call.disconnection_reason ? call : { ...call, disconnection_reason: "dial_failed" as const };
  await handleRetellEvent({ event: "call_ended", call: ended });
  if (call.call_analysis) await handleRetellEvent({ event: "call_analyzed", call: ended });
  console.log(`[watchdog] synced ${callId} from Retell (${call.call_status})`);
  return true;
}

export async function watchdogTick(): Promise<{ open_line: number; never_started: number; synced: number }> {
  const db = supabaseAdmin();
  const now = Date.now();
  let openLine = 0;
  let neverStarted = 0;
  let synced = 0;

  // 1. Lines open longer than OPEN_LINE_MINUTES.
  const openCutoff = new Date(now - config.openLineMinutes * 60 * 1000).toISOString();
  const open = await db.from("calls").select("call_id, client_id, started_at, status").eq("status", "ongoing").lt("started_at", openCutoff);
  if (open.error) throw new Error(open.error.message);
  for (const call of open.data as Row[]) {
    if (isRealCallId(call.call_id) && (await syncFromRetell(call.call_id))) {
      synced++;
      continue;
    }
    const client = await getClient(call.client_id);
    if (!client) continue;
    const minutes = Math.floor((now - new Date(call.started_at!).getTime()) / 60000);
    const alert = await createAlert({
      client_id: client.id,
      call_id: call.call_id,
      type: "open_line",
      urgency: "now",
      message: `Line still open after ${minutes} minutes. Resident may need help. Room ${client.room}.`,
    });
    if (alert) openLine++;
  }

  // 2. Crisis calls that never reached call_started within 90 seconds.
  const startCutoff = new Date(now - NEVER_STARTED_MS).toISOString();
  const stuck = await db
    .from("calls")
    .select("call_id, client_id, started_at, status")
    .eq("call_type", "crisis")
    .eq("status", "registered")
    .lt("created_at", startCutoff);
  if (stuck.error) throw new Error(stuck.error.message);
  for (const call of stuck.data as Row[]) {
    // Syncing may itself raise crisis_no_response (dial_no_answer), or show the call is live.
    if (isRealCallId(call.call_id) && (await syncFromRetell(call.call_id))) {
      synced++;
      continue;
    }
    const client = await getClient(call.client_id);
    if (!client) continue;
    const alert = await createAlert({
      client_id: client.id,
      call_id: call.call_id,
      type: "crisis_no_response",
      urgency: "now",
      message: crisisNoResponseMessage(client.room),
      quote: "Call never connected within 90 seconds.",
    });
    if (alert) neverStarted++;
  }

  // 3. Real calls that ended but whose call_analyzed never arrived.
  const late = await db
    .from("calls")
    .select("call_id, client_id, started_at, status")
    .eq("status", "ended")
    .lt("ended_at", new Date(now - ANALYSIS_LATE_MS).toISOString())
    .gt("ended_at", new Date(now - ANALYSIS_GIVE_UP_MS).toISOString());
  if (late.error) throw new Error(late.error.message);
  for (const row of late.data as Row[]) {
    const call = await fetchRetellCall(row.call_id).catch(() => null);
    if (!call?.call_analysis) continue; // Not ready yet. Try again next tick.
    await handleRetellEvent({ event: "call_analyzed", call });
    console.log(`[watchdog] synced missed call_analyzed for ${row.call_id}`);
    synced++;
  }

  return { open_line: openLine, never_started: neverStarted, synced };
}

// One loop per server, even when dev hot reload runs this file again.
export function startWatchdog() {
  const g = globalThis as unknown as { __heartbeatWatchdog?: NodeJS.Timeout };
  if (g.__heartbeatWatchdog) return;
  g.__heartbeatWatchdog = setInterval(() => {
    watchdogTick().catch((e) => console.error("[watchdog]", e instanceof Error ? e.message : e));
  }, TICK_MS);
  console.log(`[watchdog] running every ${TICK_MS / 1000}s, open line after ${config.openLineMinutes} min`);
}
