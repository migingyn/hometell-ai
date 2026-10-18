// In-process event bus behind GET /api/events (Server-Sent Events).
import { crisisCurrent, loadBoardRow } from "@/lib/status";

// Lives on globalThis so every route in the same Node server shares it.
// One server only: on Vercel, use Supabase Realtime on calls and alerts instead.

export type HeartbeatEventType = "alert" | "alert_ack" | "call" | "client_status" | "crisis";
type Listener = (type: HeartbeatEventType, data: unknown) => void;

const g = globalThis as unknown as { __heartbeatListeners?: Set<Listener> };
const listeners = (g.__heartbeatListeners ??= new Set<Listener>());

export function publish(type: HeartbeatEventType, data: unknown) {
  for (const fn of listeners) {
    try {
      fn(type, data);
    } catch (e) {
      console.error("[events] listener failed", e);
    }
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Recomputes one resident's card and pushes client_status.
export async function pushClientStatus(clientId: number) {
  const row = await loadBoardRow(clientId);
  if (row) publish("client_status", { client_id: clientId, card_status: row.card.card_status, card_reason: row.card.card_reason });
}

// Pushes the crisis board when a run is active.
export async function pushCrisis() {
  const current = await crisisCurrent();
  if (current.run) publish("crisis", { run: current.run, residents: current.residents });
}

// Never let a failed push break the caller.
export function pushQuietly(p: Promise<unknown>) {
  p.catch((e) => console.error("[events] push failed", e));
}
