// Daily round: call every resident who has not had a daily call today.
// Same order as crisis mode (vitals alert, then watch, then normal), about 2 seconds apart.
import { CALL_GAP_MS, crisisOrder, sleep } from "@/lib/crisis";
import { listCalls, startOfToday } from "@/lib/db";
import { startCall } from "@/lib/retell";
import type { Client } from "@/lib/types";

export type DailyPlan = { to_call: Client[]; skipped: Client[] };

// force: call everyone, even residents already called today.
export async function planDailyRound(force = false): Promise<DailyPlan> {
  const [order, todays] = await Promise.all([crisisOrder(), listCalls({ since: startOfToday() })]);
  // A call that could not be placed (failed_) does not count as called.
  const called = new Set(todays.filter((c) => c.call_type === "daily" && !c.call_id.startsWith("failed_")).map((c) => c.client_id));
  return {
    to_call: order.filter((c) => force || !called.has(c.id)),
    skipped: order.filter((c) => !force && called.has(c.id)),
  };
}

// One failed call never stops the rest. It is logged, and the card stays gray "No call yet today".
export async function callDailyRound(clients: Client[]): Promise<void> {
  for (const [i, client] of clients.entries()) {
    if (i > 0) await sleep(CALL_GAP_MS);
    try {
      await startCall({ clientId: client.id, call_type: "daily" });
    } catch (e) {
      console.error(`[daily] call to room ${client.room} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
