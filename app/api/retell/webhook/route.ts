// Receives Retell call events. Idempotent: a repeated call_id is ignored.
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { getCheckWithClient, getCheckEvent } from "@/lib/checks";
import { classifyCall } from "@/lib/classifier";
import { applyCallResult } from "@/lib/ladder";
import { verifyWebhook } from "@/lib/retell";
import { alertCoordinator } from "@/lib/sms";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeMode } from "@/lib/mode";
import type { Check, RetellCall } from "@/lib/types";

const Payload = z.object({
  event: z.string(),
  call: z
    .object({
      call_id: z.string(),
      metadata: z
        .object({
          check_id: z.string().uuid(),
          target: z.enum(["client", "emergency_contact"]),
          mode: z.enum(["daily", "crisis"]).optional(),
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
  // Delegated verification calls do not belong to the client check-in ladder.
  // Their signed callbacks update the separate private action record.
  const delegated = z.object({
    event: z.string(),
    call: z.object({
      call_id: z.string(),
      call_status: z.string().optional(),
      transcript: z.string().optional(),
      call_analysis: z.object({ call_summary: z.string().optional() }).optional(),
      metadata: z.object({ voice_action_id: z.string().uuid(), parent_call_id: z.string() }),
    }),
  }).safeParse(json);
  if (delegated.success) {
    if (process.env.MOCK_RETELL === "true") return fail("Delegated calls require live mode", 503);
    if (!["call_ended", "call_analyzed"].includes(delegated.data.event)) return ok({ ignored: delegated.data.event });
    const call = delegated.data.call;
    const db = supabaseAdmin();
    const { data: action, error } = await db.from("voice_actions").select("id,external_call_id,status,result")
      .eq("id", call.metadata.voice_action_id).eq("parent_call_id", call.metadata.parent_call_id).maybeSingle();
    if (error) return fail("Cannot read delegated action", 500);
    if (!action || (action.external_call_id && action.external_call_id !== call.call_id)) return fail("Unknown delegated action", 404);
    if (delegated.data.event === "call_ended" && action.status === "completed" && action.result) {
      return ok({ duplicate: true });
    }
    let write = db.from("voice_actions").update({
      external_call_id: call.call_id,
      status: ["error", "not_connected"].includes(call.call_status ?? "") ? "failed" : "completed",
      result: {
        callStatus: call.call_status,
        summary: call.call_analysis?.call_summary?.slice(0, 1800) ?? null,
        transcript: call.transcript?.slice(0, 3000) ?? null,
        limitation: "Recipient statements are reported information, not proof of a completed real-world action.",
      },
    }).eq("id", action.id);
    if (delegated.data.event === "call_ended") write = write.in("status", ["dispatching", "queued", "unknown"]);
    const { error: updateError } = await write;
    if (updateError) return fail("Cannot save delegated action", 500);
    return ok({ delegated: true });
  }
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  if (parsed.data.event !== "call_analyzed") return ok({ ignored: parsed.data.event });

  const call = parsed.data.call as RetellCall;
  const meta = call.metadata;
  if (!meta) return fail("Call has no metadata.check_id");

  try {
    const check = await getCheckWithClient(meta.check_id);
    if (!check) return fail("Unknown check", 404);

    if (check.status === "handled") return ok({ skipped: "handled" });
    if (call.call_id !== check.last_call_id) {
      const { data: pending } = await supabaseAdmin().from("checks").select("action_token").eq("id", check.id).single();
      if (check.status === "queued" || pending?.action_token) return fail("Call dispatch is still being saved; retry this callback", 503);
      return ok({ skipped: "stale_call" });
    }
    const event = await getCheckEvent(check);
    const mode = normalizeMode(event.type);
    const result = await classifyCall(call, { mode, target: meta.target, contactName: check.client.emergency_contact_name });
    const patch = applyCallResult(check, result, meta.target, call.call_id);
    if (!Object.keys(patch).length) return ok({ skipped: "protected_result" });
    const db = supabaseAdmin();
    const { data: applied, error: applyError } = await db.rpc("apply_heartbeat_result", {
      p_check_id: check.id, p_call_id: call.call_id, p_target: meta.target,
      p_result: { ...result, ...patch }, p_transcript: call.transcript ?? null,
      p_raw: json, p_next_action_at: patch.next_action_at ?? null,
    });
    if (applyError) return fail(applyError.message, 500);
    if (!applied?.applied) return ok(applied ?? { skipped: "not_applied" });
    const updated = applied.check as Check;

    // Daily requests are follow-ups. Only hard-rule danger hits text immediately;
    // all crisis help reports and terminal unreachable checks notify a person.
    if (updated.status === "needs_human" && (applied.prior_status !== "needs_human" || check.urgency !== "urgent") &&
      (mode === "crisis" || result.urgency === "urgent")) {
      const sms = await alertCoordinator(check.client, updated.flag_reason ?? updated.summary ?? "");
      updated.sms_status = sms.note;
      const { error: smsError } = await db.from("checks").update({ sms_status: sms.note })
        .eq("id", check.id).eq("last_call_id", call.call_id);
      if (smsError) return fail("Call result saved, but SMS status could not be saved", 500);
    }

    // P1: use an explicit boolean from a daily client answer; a missing field
    // never clears an existing ride need, and contacts cannot overwrite it.
    const clientStatus = call.call_analysis?.custom_analysis_data?.client_status;
    if (mode === "daily" && meta.target === "client" && result.status !== "no_answer" &&
      (clientStatus === "ok" || clientStatus === "needs_help")) {
      const needsRide = call.call_analysis?.custom_analysis_data?.needs_ride;
      const { error: clientError } = await db.from("clients").update({
        last_daily_at: new Date().toISOString(),
        ...(typeof needsRide === "boolean" ? { needs_ride: needsRide } : {}),
      }).eq("id", check.client_id);
      if (clientError) return fail("Check saved, but daily planning fields could not be saved", 500);
      await db.from("checks").update({ summary: updated.summary }).eq("id", check.id).eq("last_call_id", call.call_id);
    }
    return ok({ check: updated });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
