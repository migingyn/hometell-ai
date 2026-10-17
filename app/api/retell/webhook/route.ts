// Receives Retell call events. Idempotent: a repeated call_id is ignored.
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { getCheckWithClient, updateCheck } from "@/lib/checks";
import { classifyCall } from "@/lib/classifier";
import { applyCallResult } from "@/lib/ladder";
import { verifyWebhook } from "@/lib/retell";
import { alertCoordinator } from "@/lib/sms";
import { supabaseAdmin } from "@/lib/supabase";
import type { RetellCall } from "@/lib/types";

const Payload = z.object({
  event: z.string(),
  call: z
    .object({
      call_id: z.string(),
      metadata: z
        .object({
          check_id: z.string().uuid(),
          target: z.enum(["client", "emergency_contact"]),
          mock_outcome: z.enum(["ok", "needs_human", "no_answer"]).optional(),
        })
        .optional(),
    })
    .passthrough(),
});

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyWebhook(raw, req.headers.get("x-retell-signature")))) {
    return fail("Bad signature", 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("Body is not JSON");
  }
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  // TODO(Mikey): confirm call_analyzed is the right event to act on, and whether
  // call_started should flip the card to calling.
  if (parsed.data.event !== "call_analyzed") return ok({ ignored: parsed.data.event });

  const call = parsed.data.call as RetellCall;
  const meta = call.metadata;
  if (!meta) return fail("Call has no metadata.check_id");

  try {
    const check = await getCheckWithClient(meta.check_id);
    if (!check) return fail("Unknown check", 404);

    const db = supabaseAdmin();
    const { data: seen } = await db.from("call_logs").select("id").eq("retell_call_id", call.call_id).maybeSingle();
    if (seen) return ok({ duplicate: true });

    const result = await classifyCall(call);

    // Unique retell_call_id: if two copies race, the second inserts nothing and stops here.
    const { data: logged, error: logError } = await db
      .from("call_logs")
      .upsert(
        {
          check_id: check.id,
          retell_call_id: call.call_id,
          target: meta.target,
          outcome: result.status,
          transcript: call.transcript ?? null,
          raw: json,
        },
        { onConflict: "retell_call_id", ignoreDuplicates: true },
      )
      .select("id");
    if (logError) return fail(logError.message, 500);
    if (!logged?.length) return ok({ duplicate: true });

    // A coordinator decision wins over any late call result.
    if (check.status === "handled") return ok({ skipped: "handled" });

    // TODO(Mikey): ignore results from a call that is not check.last_call_id (stale retries).
    const updated = await updateCheck(check.id, applyCallResult(check, result, meta.target));

    if (updated.status === "needs_human" && check.status !== "needs_human") {
      await alertCoordinator(check.client, updated.flag_reason ?? updated.summary ?? "");
    }

    return ok({ check: updated });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
