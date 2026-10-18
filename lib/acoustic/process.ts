import { getCheckEvent, getCheckWithClient } from "@/lib/checks";
import { assessCallerPriority } from "@/lib/classifier/priority";
import { normalizeMode } from "@/lib/mode";
import { supabaseAdmin } from "@/lib/supabase";
import { alertCoordinator } from "@/lib/sms";
import type { CallTarget, RetellCall } from "@/lib/types";
import { analyzeAudio, unavailableAudio } from "./client";
import { combineAcousticPriority } from "./policy";
import { getCallerRecording } from "./recording";
import type { AcousticAnalysis, AcousticAssessment } from "./types";

/** Post-response work only. Live transcript callbacks never wait for audio inference. */
export async function processCallAcoustics(checkId: string, callId: string, target: CallTarget, call: RetellCall) {
  if (!process.env.ACOUSTIC_SERVICE_URL?.trim() || process.env.MOCK_RETELL === "true") return;
  const check = await getCheckWithClient(checkId);
  if (!check || check.last_call_id !== callId || check.status === "handled" || check.handled_at ||
    (check.acoustic_assessment?.call_id === callId && check.acoustic_assessment.result.status === "available")) return;
  let result: AcousticAnalysis;
  try {
    if (check.client.language && check.client.language !== "en") {
      result = unavailableAudio("This experimental acoustic model is limited to English speech. Review this call manually.");
    } else {
      const { bytes, segments } = await getCallerRecording(callId, call);
      const channel = process.env.RETELL_CALLER_AUDIO_CHANNEL?.trim();
      if (channel && !/^[01]$/.test(channel)) throw new Error("Invalid calibrated caller channel");
      result = await analyzeAudio(bytes, segments, channel ? Number(channel) : undefined);
    }
  } catch {
    // Do not expose signed recording URLs, provider error bodies, or credentials.
    result = unavailableAudio("Caller audio could not be analyzed. Check the service, separate-speaker recording access, and caller-channel attribution.");
  }
  const event = await getCheckEvent(check);
  const baseline = check.priority_assessment ?? assessCallerPriority(call, { mode: normalizeMode(event.type), target }, "post_call");
  const priority = combineAcousticPriority(baseline, result);
  const acoustic: AcousticAssessment = { call_id: callId, source: "retell_recording", analyzed_at: new Date().toISOString(), result };
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("apply_heartbeat_acoustic", {
    p_check_id: checkId, p_call_id: callId, p_target: target, p_acoustic: acoustic, p_priority: priority,
  });
  if (error) throw new Error("Could not save acoustic assessment; apply the acoustic-priority migration");
  if (data?.newly_escalated && data.check?.urgency === "urgent") {
    const sms = await alertCoordinator(check.client, priority.reasons.join(" "));
    await db.from("checks").update({ sms_status: sms.note }).eq("id", checkId).eq("last_call_id", callId).neq("status", "handled");
  }
}
