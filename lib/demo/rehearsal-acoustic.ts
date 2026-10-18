import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { getCheckWithClient } from "@/lib/checks";
import { analyzeAudio, unavailableAudio } from "@/lib/acoustic/client";
import { combineAcousticPriority } from "@/lib/acoustic/policy";
import { getRehearsalCallerRecording, RecordingBindingError } from "@/lib/acoustic/recording";
import { assessCallerPriority } from "@/lib/classifier/priority";
import { readRehearsal, type RehearsalRow } from "@/lib/demo/rehearsal";
import type { AcousticAnalysis, AcousticAssessment } from "@/lib/acoustic/types";

/** Eligibility is only an optimization; the database claim is authoritative. */
export function rehearsalAcousticsDue(row: RehearsalRow, now = Date.now()): boolean {
  if (!row.call_id || row.status !== "analyzed" || row.call_id.startsWith("mock_")) return false;
  if (["available", "insufficient_audio", "unavailable"].includes(row.acoustic_status ?? "")) return false;
  if (row.acoustic_status === "processing" && Date.parse(row.acoustic_lease_until ?? "") > now) return false;
  return !row.acoustic_retry_at || Date.parse(row.acoustic_retry_at) <= now;
}

/** Runs after the response. No calls, texts, or dispatches are made by this path. */
export async function processRehearsalAcoustics(checkId: string): Promise<void> {
  const row = await readRehearsal(checkId);
  if (!row || !rehearsalAcousticsDue(row)) return;
  const db = supabaseAdmin();
  const token = randomUUID();
  const { data: claim, error: claimError } = await db.rpc("claim_heartbeat_rehearsal_acoustic", {
    p_request_id: row.request_id, p_call_id: row.call_id, p_token: token,
  });
  if (claimError) throw new Error("Cannot claim rehearsal voice analysis; apply the rehearsal acoustics migration.");
  if (!claim?.claimed) return;
  const claimed = claim.rehearsal as RehearsalRow;
  const check = await getCheckWithClient(row.check_id);
  // The finish function rechecks current call and handled state under its lock.
  if (!check) return;
  let result: AcousticAnalysis;
  let retry = false;
  try {
    if (check.client.language && check.client.language !== "en") {
      result = unavailableAudio("This experimental voice analysis supports English only. Review the call manually.");
    } else {
      const { bytes, segments } = await getRehearsalCallerRecording({ requestId: claimed.request_id,
        checkId: claimed.check_id, callId: claimed.call_id!, agentId: claimed.agent_id }, claimed.raw?.call);
      const channel = process.env.RETELL_CALLER_AUDIO_CHANNEL?.trim();
      if (channel && !/^[01]$/.test(channel)) throw new RecordingBindingError("Invalid calibrated caller channel");
      result = await analyzeAudio(bytes, segments, channel ? Number(channel) : undefined);
      retry = result.status === "unavailable";
    }
  } catch (error) {
    retry = !(error instanceof RecordingBindingError);
    // No signed recording links, provider bodies, or credentials enter public state.
    result = unavailableAudio("The caller recording could not be analyzed. Review the transcript and recording with a person.");
  }
  const call = claimed.raw?.call ?? { call_id: claimed.call_id! };
  const baseline = check.last_call_id === claimed.call_id && check.priority_assessment
    ? check.priority_assessment : assessCallerPriority(call, { mode: "crisis", target: "client" }, "post_call");
  const acoustic: AcousticAssessment = { call_id: claimed.call_id!, source: "retell_recording", analyzed_at: new Date().toISOString(), result };
  const { error } = await db.rpc("finish_heartbeat_rehearsal_acoustic", {
    p_request_id: claimed.request_id, p_call_id: claimed.call_id, p_token: token,
    p_acoustic: acoustic, p_priority: combineAcousticPriority(baseline, result), p_retry: retry,
  });
  if (error) throw new Error("Cannot save rehearsal voice analysis.");
}
