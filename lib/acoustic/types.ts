/** Our self-hosted speech model's output; scores are not medical probabilities. */
export type AcousticAnalysis = {
  version: "1";
  status: "available" | "insufficient_audio" | "unavailable";
  signal: "elevated" | "uncertain";
  model: { id: string; revision: string; labels: string[] };
  scores: Record<string, number>;
  quality: {
    duration_seconds: number;
    speech_seconds: number;
    clipping_fraction: number;
    sample_rate: number;
    channels: number;
    caller_channel: number | null;
    channel_attribution?: "explicit" | "transcript_energy" | "unresolved";
    window_count: number;
  };
  segments: { start_seconds: number; end_seconds: number; signal: "elevated" | "uncertain"; scores: Record<string, number> }[];
  warnings: string[];
};

export type AcousticAssessment = {
  call_id: string;
  source: "retell_recording" | "local_test";
  analyzed_at: string;
  result: AcousticAnalysis;
};

export type SpeakerSegment = { role: "user" | "agent"; start: number; end: number };
