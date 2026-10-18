import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { getHeartbeatCallingReadiness, placeCall } from "@/lib/retell";
import { supabaseAdmin } from "@/lib/supabase";
import { config } from "@/lib/config";
import { normalizeMode } from "@/lib/mode";
import { sortClientsForEvent } from "@/lib/ordering";
import type { Check, Client, HeartbeatEvent } from "@/lib/types";

const Body = z.object({
  type: z.enum(["daily", "crisis", "heat_wave"]).default("heat_wave"),
  alert_text: z.string().min(1).max(1400).refine((text) => !!text.trim(), "Alert cannot be blank").optional(),
  request_id: z.string().uuid().optional(),
});
export const maxDuration = 300;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));
  const mode = normalizeMode(parsed.data.type);
  if (mode === "crisis" && !parsed.data.alert_text) return fail("Paste the official alert before starting a crisis check.");
  if (!config.mockRetell) {
    if (!getHeartbeatCallingReadiness(mode).configured) {
      return fail("Real calling is not configured. Add the Retell key, E.164 number, and a separate dedicated agent ID for this check-in mode, or explicitly enable MOCK_RETELL for rehearsal.", 503);
    }
  }
  try {
    const db = supabaseAdmin();
    const { data: clients, error: clientsError } = await db.from("clients").select("*");
    if (clientsError) return fail(clientsError.message, 500);
    if (!clients?.length) return fail("No enrolled clients. Run npm run seed first.");
    if (!config.mockRetell && clients.some((client: Client) => /^\+1555/.test(client.phone) || /^\+1555/.test(client.emergency_contact_phone))) {
      return fail("This roster contains fictional phone numbers. Seed consenting teammates before live calls.", 409);
    }
    const { data: started, error: eventError } = await db.rpc("start_heartbeat_event", {
      p_type: mode, p_alert: mode === "crisis" ? parsed.data.alert_text : null,
      p_request_id: parsed.data.request_id ?? null,
    });
    if (eventError) return fail(eventError.message, 500);
    if (started.busy) return fail("A roster is already being called. Wait for that start to finish.", 409);
    if (started.duplicate) return ok({ event: started.event, duplicate: true });
    const event = started.event as HeartbeatEvent;
    const sorted = sortClientsForEvent(clients as Client[], mode);
    const { data: checks, error: checksError } = await db.from("checks")
      .insert(sorted.map((client) => ({ event_id: event.id, client_id: client.id, status: "queued" }))).select();
    if (checksError) {
      await db.from("events").update({ dispatching: false }).eq("id", event.id);
      return fail(checksError.message, 500);
    }
    const checkByClient = new Map((checks as Check[]).map((check) => [check.client_id, check]));
    let failed = 0;
    // Save each call immediately so a later failure cannot lose an earlier call.
    for (const client of sorted) {
      const check = checkByClient.get(client.id)!;
      try {
        const call = await placeCall({ client, checkId: check.id, target: "client", event: event as HeartbeatEvent });
        const { error } = await db.from("checks").update({ status: "calling", last_call_id: call.callId })
          .eq("id", check.id).eq("status", "queued");
        if (error) throw error;
      } catch {
        failed++;
        await db.from("checks").update({ status: "needs_human", urgency: "urgent", flag_reason: "Call could not be confirmed. Review the provider before retrying.", summary: "Coordinator follow-up required.", next_action_at: null })
          .eq("id", check.id).eq("status", "queued");
      }
    }
    const { error: finishError } = await db.from("events").update({ dispatching: false }).eq("id", event.id);
    if (finishError) return fail("Calls started, but completion could not be saved. Refresh before trying again.", 500);
    return ok({ event, checkCount: checks!.length, failed, mockMode: config.mockRetell });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Cannot start check-ins", 500);
  }
}
