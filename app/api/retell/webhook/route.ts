// Receives Retell call events. Idempotent: a repeated call_id is ignored.
import { z } from "zod";
import { after } from "next/server";
import { fail, ok } from "@/lib/api";
import { getCheckWithClient, getCheckEvent } from "@/lib/checks";
import { classifyCall } from "@/lib/classifier";
import { applyCallResult } from "@/lib/ladder";
import { verifyRetellSignature, verifyWebhook } from "@/lib/retell";
import { alertCoordinator } from "@/lib/sms";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeMode } from "@/lib/mode";
import { assessCallerPriority } from "@/lib/classifier/priority";
import { processCallAcoustics } from "@/lib/acoustic/process";
import { buildPostOpAssessment } from "@/lib/postop/assessment";
import { previousPostOpAssessment } from "@/lib/postop/store";
import { isNurseTransferEvent } from "@/lib/postop/transfer";
import { reportedRideNeed } from "@/lib/postop/ride";
import type { Check, RetellCall } from "@/lib/types";
import { interceptRehearsalWebhook, RehearsalError } from "@/lib/demo/rehearsal";
import { processRehearsalAcoustics } from "@/lib/demo/rehearsal-acoustic";
import { saveTranscript } from "@/lib/transcript/store";
import type { TranscriptEvent } from "@/lib/transcript/snapshot";

export const maxDuration = 240;

function scheduleAcoustics(checkId: string, call: RetellCall) {
  if (!process.env.ACOUSTIC_SERVICE_URL?.trim() || process.env.MOCK_RETELL === "true" || !call.metadata) return;
  const target = call.metadata.target;
  after(async () => {
    try { await processCallAcoustics(checkId, call.call_id, target, call); }
    catch { console.warn("Post-call acoustic assessment could not be saved; retry the signed call-analyzed event."); }
  });
}

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
  try {
    if (await interceptRehearsalWebhook(raw, req.headers.get("x-retell-signature"), (checkId) => {
      after(async () => {
        try { await processRehearsalAcoustics(checkId); }
        catch { console.warn("Rehearsal voice analysis will recover on a later status refresh."); }
      });
    })) return ok({ rehearsal: true });
  } catch (error) {
    return fail(error instanceof RehearsalError ? error.message : "Cannot save rehearsal callback.", error instanceof RehearsalError ? error.status : 500);
  }
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

  const live = parsed.data.event === "transcript_updated";
  const transfer = isNurseTransferEvent(parsed.data.event);
  const transcriptEvent = ["call_started", "transcript_updated", "call_ended", "call_analyzed"].includes(parsed.data.event);
  if (!transcriptEvent && !transfer) return ok({ ignored: parsed.data.event });

  const call = parsed.data.call as RetellCall;
  // Global mock mode permits only explicit mock IDs to bypass signing. A real
  // ordinary-call transcript must be authenticated even during a sample demo.
  if (!call.call_id.startsWith("mock_") && !(await verifyRetellSignature(raw, req.headers.get("x-retell-signature")))) {
    return fail("Bad signature", 401);
  }
  let meta = call.metadata;

  try {
    // Transfer callbacks can contain only call_id. The signed provider event
    // can resolve only a currently assigned check, never an arbitrary patient.
    if (transfer && !meta) {
      const { data, error } = await supabaseAdmin().from("checks").select("id,ladder_step")
        .eq("last_call_id", call.call_id).maybeSingle();
      if (error) return fail("Cannot locate nurse transfer call", 500);
      if (!data) return ok({ skipped: "unknown_transfer_call" });
      meta = { check_id: data.id, target: data.ladder_step === 3 ? "emergency_contact" : "client" };
    }
    if (!meta) return fail("Call has no metadata.check_id");
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
    if (transfer) {
      if (meta.target !== (check.ladder_step === 3 ? "emergency_contact" : "client")) return ok({ skipped: "wrong_target" });
      const db = supabaseAdmin();
      const { data: applied, error } = await db.rpc("apply_heartbeat_transfer", {
        p_check_id: check.id, p_call_id: call.call_id, p_event: parsed.data.event,
      });
      if (error) return fail("Cannot save nurse transfer. Apply the post-operative migration.", 500);
      if (applied?.applied && ["failed", "ended_unconfirmed"].includes(applied.check?.nurse_transfer?.status)) {
        const sms = await alertCoordinator(check.client, applied.check.flag_reason ?? "Nurse transfer was not confirmed; patient follow-up remains open.");
        await db.from("checks").update({ sms_status: sms.note }).eq("id", check.id).eq("last_call_id", call.call_id).neq("status", "handled");
      }
      return ok(applied ?? { skipped: "not_applied" });
    }
    if (meta.target !== (check.ladder_step === 3 ? "emergency_contact" : "client")) return ok({ skipped: "wrong_target" });
    const transcript = await saveTranscript(check.id, meta.target, parsed.data.event as TranscriptEvent, call);
    // Ended is transport evidence only: do not consume the final call-log slot.
    // Analyzed always continues to the existing atomic result ledger, including
    // after a retry whose transcript snapshot already committed successfully.
    if (parsed.data.event === "call_started" || parsed.data.event === "call_ended" || (live && !transcript.applied && !transcript.duplicate)) return ok(transcript);
    if (live) {
      const assessment = assessCallerPriority(call, { mode, target: meta.target, contactName: check.client.emergency_contact_name }, "live");
      const turns = call.transcript_object ?? call.transcript_with_tool_calls;
      const turnCount = Array.isArray(turns) ? turns.length : (call.transcript?.split(/\r?\n/).length ?? 0);
      const db = supabaseAdmin();
      const { data: applied, error } = await db.rpc("apply_heartbeat_priority", {
        p_check_id: check.id, p_call_id: call.call_id, p_target: meta.target,
        p_assessment: assessment, p_turn_count: turnCount,
      });
      if (error) return fail("Cannot save live caller priority; apply the caller-priority migration", 500);
      if (applied?.newly_escalated) {
        const sms = await alertCoordinator(check.client, assessment.reasons.join(" "));
        await db.from("checks").update({ sms_status: sms.note }).eq("id", check.id).eq("last_call_id", call.call_id).neq("status", "handled");
      }
      return ok(applied ?? { skipped: "not_applied" });
    }
    let result = await classifyCall(call, { mode, target: meta.target, contactName: check.client.emergency_contact_name });
    const postop = mode === "daily" && meta.target === "client" && result.status !== "no_answer"
      ? buildPostOpAssessment(call, { mode, target: meta.target, patientName: check.client.name }, await previousPostOpAssessment(check.client_id, event.started_at))
      : null;
    if (postop && result.status === "ok") result = {
      ...result, status: "needs_human", urgency: "follow_up", flag_reason: "Post-operative check-in awaits nurse review.",
    };
    let patch = applyCallResult(check, result, meta.target, call.call_id);
    // Existing danger alerts still protect the outcome while allowing the
    // patient evidence to be saved for the nurse in the same atomic write.
    if (postop && !Object.keys(patch).length) patch = {
      status: check.status, urgency: check.urgency, flag_reason: check.flag_reason,
      summary: result.summary, next_action_at: null,
    };
    if (!Object.keys(patch).length) return ok({ skipped: "protected_result" });
    const db = supabaseAdmin();
    const { data: applied, error: applyError } = await db.rpc("apply_heartbeat_result", {
      p_check_id: check.id, p_call_id: call.call_id, p_target: meta.target,
      p_result: { ...result, ...patch, ...(postop ? { postop_assessment: postop } : {}) }, p_transcript: call.transcript ?? null,
      p_raw: json, p_next_action_at: patch.next_action_at ?? null,
    });
    if (applyError) return fail(applyError.message, 500);
    if (!applied?.applied) {
      if (applied?.duplicate) scheduleAcoustics(check.id, call);
      return ok(applied ?? { skipped: "not_applied" });
    }
    scheduleAcoustics(check.id, call);
    const updated = applied.check as Check;

    // Daily requests are follow-ups. Only hard-rule danger hits text immediately;
    // all crisis help reports and terminal unreachable checks notify a person.
    if (updated.status === "needs_human" && (applied.prior_status !== "needs_human" || check.urgency !== "urgent") &&
      (mode === "crisis" || updated.urgency === "urgent")) {
      const sms = await alertCoordinator(check.client, updated.flag_reason ?? updated.summary ?? "");
      updated.sms_status = sms.note;
      const { error: smsError } = await db.from("checks").update({ sms_status: sms.note })
        .eq("id", check.id).eq("last_call_id", call.call_id);
      if (smsError) return fail("Call result saved, but SMS status could not be saved", 500);
    }

    // Daily planning requires a verified patient identity. Model-issued status
    // and ride fields from an unconfirmed speaker cannot complete a check-in.
    const clientStatus = call.call_analysis?.custom_analysis_data?.client_status;
    if (mode === "daily" && meta.target === "client" && postop?.patient_confirmed === true && result.status !== "no_answer" &&
      (clientStatus === "ok" || clientStatus === "needs_help")) {
      const needsRide = reportedRideNeed(call);
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
