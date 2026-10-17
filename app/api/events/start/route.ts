// Starts a crisis event and calls every client, red tier first.
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { placeCallsInOrder } from "@/lib/retell";
import { supabaseAdmin } from "@/lib/supabase";
import type { Check, Client, RiskTier } from "@/lib/types";

const Body = z.object({ type: z.string().min(1).default("heat_wave") });

const TIER_ORDER: Record<RiskTier, number> = { red: 0, yellow: 1, green: 2 };

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  try {
    const db = supabaseAdmin();

    const { data: clients, error: clientsError } = await db.from("clients").select("*");
    if (clientsError) return fail(clientsError.message, 500);
    if (!clients?.length) return fail("No clients. Run npx tsx scripts/seed.ts", 400);

    const { data: event, error: eventError } = await db
      .from("events")
      .insert({ type: parsed.data.type })
      .select()
      .single();
    if (eventError) return fail(eventError.message, 500);

    const sorted = (clients as Client[]).sort((a, b) => TIER_ORDER[a.risk_tier] - TIER_ORDER[b.risk_tier]);

    const { data: checks, error: checksError } = await db
      .from("checks")
      .insert(sorted.map((c) => ({ event_id: event.id, client_id: c.id, status: "queued" })))
      .select();
    if (checksError) return fail(checksError.message, 500);

    const checkByClient = new Map((checks as Check[]).map((c) => [c.client_id, c]));
    const inputs = sorted.map((client) => ({
      client,
      checkId: checkByClient.get(client.id)!.id,
      target: "client" as const,
    }));

    const results = await placeCallsInOrder(inputs);

    await Promise.all(
      results.map((r, i) =>
        db.from("checks").update({ status: "calling", last_call_id: r.callId }).eq("id", inputs[i].checkId),
      ),
    );

    return ok({ event, checkCount: checks.length });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
