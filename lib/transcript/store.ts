import { supabaseAdmin } from "@/lib/supabase";
import type { CallTarget, RetellCall } from "@/lib/types";
import { transcriptSnapshot, transcriptStatus, type TranscriptEvent, type TranscriptStatus, type TranscriptTurn } from "./snapshot";

export type StoredTranscript = {
  call_id: string; check_id: string; target: CallTarget; status: TranscriptStatus;
  turns: TranscriptTurn[]; updated_at: string; truncated: boolean;
};
export type TranscriptWrite = { applied?: boolean; duplicate?: boolean; skipped?: string; status?: TranscriptStatus };

export async function saveTranscript(checkId: string, target: CallTarget, event: TranscriptEvent, call: RetellCall): Promise<TranscriptWrite> {
  const snapshot = transcriptSnapshot(call);
  const { data, error } = await supabaseAdmin().rpc("apply_heartbeat_transcript", {
    p_check_id: checkId, p_call_id: call.call_id, p_target: target, p_status: transcriptStatus(event),
    p_turns: snapshot.turns, p_end_seconds: snapshot.endSeconds, p_truncated: snapshot.truncated,
  });
  if (error) throw new Error("Cannot save live transcript. Apply the live-transcripts migration.");
  return data ?? { skipped: "not_applied" };
}

export async function readTranscript(checkId: string, callId: string, target: CallTarget): Promise<StoredTranscript | null> {
  const { data, error } = await supabaseAdmin().from("heartbeat_call_transcripts")
    .select("call_id,check_id,target,status,turns,updated_at,truncated")
    .eq("check_id", checkId).eq("call_id", callId).eq("target", target).maybeSingle();
  // An old deployment can still expose finalized call_logs before migration 011.
  if (error && ["PGRST205", "42P01"].includes(error.code)) return null;
  if (error) throw new Error("Cannot read the current live transcript.");
  return data as StoredTranscript | null;
}
