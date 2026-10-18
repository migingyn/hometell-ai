// Crisis mode: call every resident, alert vitals first, then watch, then normal.
import { activeCrisisRun, listClients, todayEntries } from "@/lib/db";
import { pushCrisis, pushQuietly } from "@/lib/events";
import { startCall } from "@/lib/retell";
import { supabaseAdmin } from "@/lib/supabase";
import { VITALS_ORDER, vitalsStatus } from "@/lib/vitals";
import type { Client, CrisisRun, CrisisType } from "@/lib/types";

export const CALL_GAP_MS = 2000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Residents in crisis call order.
export async function crisisOrder(): Promise<Client[]> {
  const [clients, entries] = await Promise.all([listClients(), todayEntries()]);
  const rank = (c: Client) => VITALS_ORDER[vitalsStatus(entries.find((e) => e.client_id === c.id) ?? null, c.vitals_ranges).status];
  return clients.sort((a, b) => rank(a) - rank(b));
}

// Ends any open run and opens a new one.
export async function openCrisisRun(crisisType: CrisisType): Promise<CrisisRun> {
  const db = supabaseAdmin();
  const closed = await db.from("crisis_runs").update({ ended_at: new Date().toISOString() }).is("ended_at", null);
  if (closed.error) throw new Error(closed.error.message);
  const { data, error } = await db.from("crisis_runs").insert({ crisis_type: crisisType }).select().single();
  if (error) throw new Error(error.message);
  pushQuietly(pushCrisis());
  return data as CrisisRun;
}

// Places every crisis call about 2 seconds apart. One failure never stops the rest:
// startCall already raised a crisis_no_response alert for it.
export async function callEveryone(run: CrisisRun): Promise<void> {
  const clients = await crisisOrder();
  for (const [i, client] of clients.entries()) {
    if (i > 0) await sleep(CALL_GAP_MS);
    try {
      await startCall({ clientId: client.id, call_type: "crisis", crisis_type: run.crisis_type, crisis_run_id: run.id });
    } catch (e) {
      console.error(`[crisis] call to room ${client.room} failed`, e);
    }
  }
}

export async function endCrisisRun(): Promise<CrisisRun | null> {
  const run = await activeCrisisRun();
  if (!run) return null;
  const { data, error } = await supabaseAdmin()
    .from("crisis_runs")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", run.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  pushQuietly(pushCrisis());
  return data as CrisisRun;
}
