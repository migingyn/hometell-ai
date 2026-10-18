import type { AcousticAssessment } from "@/lib/acoustic/types";

/** Public progress only. Recording URLs and model internals stay on the server. */
export type VoiceAnalysisState = {
  status: "waiting_for_call" | "waiting_for_recording" | "processing" | "available" | "insufficient_audio" | "unavailable";
  signal: "elevated" | "uncertain" | null;
  updatedAt: string | null;
  retryPending: boolean;
};

export function currentVoiceAnalysis(
  callId: string | null | undefined,
  evidence: { callId: string | null; voiceAnalysis?: VoiceAnalysisState | null } | undefined,
  acoustic: AcousticAssessment | null | undefined,
): VoiceAnalysisState | null {
  if (!callId) return null;
  if (evidence?.callId === callId && evidence.voiceAnalysis) return evidence.voiceAnalysis;
  if (acoustic?.call_id !== callId) return null;
  return {
    status: acoustic.result.status,
    signal: acoustic.result.status === "available" ? acoustic.result.signal : null,
    updatedAt: acoustic.analyzed_at,
    retryPending: false,
  };
}

export function voiceAnalysisResolved(voice: VoiceAnalysisState | null | undefined) {
  return Boolean(voice && !voice.retryPending && ["available", "insufficient_audio", "unavailable"].includes(voice.status));
}

export function voiceAnalysisCopy(voice: VoiceAnalysisState) {
  switch (voice.status) {
    case "waiting_for_call": return { title: "Waiting for the call to finish", detail: "The caller’s recorded voice is analyzed after the conversation ends.", receipt: "Voice analysis follows the call" };
    case "waiting_for_recording": return { title: "Waiting for the recording", detail: "The call has ended. Voice analysis starts when the recording is ready.", receipt: "Waiting for the voice recording" };
    case "processing": return { title: "Analyzing the caller’s voice", detail: "Checking vocal expression separately from what the caller said.", receipt: "Voice analysis in progress" };
    case "available": return voice.signal === "elevated"
      ? { title: "Elevated vocal expression", detail: "Can bring human attention sooner within the same severity tier.", receipt: "Voice analysis available below" }
      : { title: "Voice expression uncertain", detail: "No reliable elevated-expression signal. Review the caller’s words and situation.", receipt: "Voice analysis available below" };
    case "insufficient_audio": return { title: "Not enough usable caller audio", detail: "Voice expression could not be assessed. Keep following the reported situation.", receipt: "Voice signal unavailable · limited audio" };
    case "unavailable": return { title: voice.retryPending ? "Voice analysis will retry" : "Voice analysis unavailable", detail: voice.retryPending ? "The recording or analysis service is not ready. Another check is pending." : "No voice result is available. Keep following the reported situation.", receipt: voice.retryPending ? "Voice analysis retry pending" : "Voice analysis unavailable" };
  }
}
