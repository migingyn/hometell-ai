import { z } from "zod";
import type { AcousticAnalysis, SpeakerSegment } from "./types";

const scores = z.record(z.string().min(1).max(60), z.number().finite().min(0).max(1));
export const AcousticResponse = z.object({
  version: z.literal("1"),
  status: z.enum(["available", "insufficient_audio", "unavailable"]),
  signal: z.enum(["elevated", "uncertain"]),
  model: z.object({ id: z.string().min(1).max(200), revision: z.string().min(1).max(100), labels: z.array(z.string().max(60)).max(20) }),
  scores,
  quality: z.object({
    duration_seconds: z.number().finite().min(0).max(1800), speech_seconds: z.number().finite().min(0).max(1800),
    clipping_fraction: z.number().finite().min(0).max(1), sample_rate: z.number().int().min(0).max(192000),
    channels: z.number().int().min(0).max(8), caller_channel: z.number().int().min(0).max(7).nullable(),
    channel_attribution: z.enum(["explicit", "transcript_energy", "unresolved"]).optional(),
    window_count: z.number().int().min(0).max(500),
  }),
  segments: z.array(z.object({
    start_seconds: z.number().finite().min(0), end_seconds: z.number().finite().min(0),
    signal: z.enum(["elevated", "uncertain"]), scores,
  })).max(500),
  warnings: z.array(z.string().max(1000)).max(30),
}).superRefine((value, ctx) => {
  if (value.status === "available" && (value.quality.caller_channel === null || value.quality.window_count < 1 ||
    value.quality.speech_seconds < 2 || !Object.keys(value.scores).length ||
    value.quality.caller_channel >= value.quality.channels || value.quality.channel_attribution === "unresolved")) {
    ctx.addIssue({ code: "custom", message: "Available analysis requires attributable caller speech and model output" });
  }
  if (value.status !== "available" && value.signal !== "uncertain") ctx.addIssue({ code: "custom", message: "Unavailable audio cannot supply a distress signal" });
});

/** Only roles and word timings leave the app; transcript text is not sent. */
export function speakerSegments(turns: unknown): SpeakerSegment[] {
  if (!Array.isArray(turns)) return [];
  const segments: SpeakerSegment[] = [];
  for (const turn of turns.slice(0, 1000)) {
    if (!turn || (turn.role !== "user" && turn.role !== "agent") || !Array.isArray(turn.words)) continue;
    const valid = turn.words.slice(0, 1000).filter((word: { start?: number; end?: number }) =>
      typeof word?.start === "number" && Number.isFinite(word.start) && word.start >= 0 &&
      typeof word.end === "number" && Number.isFinite(word.end) && word.end > word.start && word.end <= 1800);
    if (valid.length) segments.push({ role: turn.role, start: Math.min(...valid.map((w: { start: number }) => w.start)),
      end: Math.max(...valid.map((w: { end: number }) => w.end)) });
  }
  return segments;
}

export function unavailableAudio(reason: string): AcousticAnalysis {
  return { version: "1", status: "unavailable", signal: "uncertain", model: { id: "not_run", revision: "not_run", labels: [] },
    scores: {}, quality: { duration_seconds: 0, speech_seconds: 0, clipping_fraction: 0, sample_rate: 0,
      channels: 0, caller_channel: null, channel_attribution: "unresolved", window_count: 0 }, segments: [], warnings: [reason] };
}

export async function analyzeAudio(bytes: Uint8Array, segments: SpeakerSegment[], callerChannel?: number): Promise<AcousticAnalysis> {
  const service = process.env.ACOUSTIC_SERVICE_URL?.trim();
  if (!service) throw new Error("Acoustic service is not configured");
  const base = new URL(service);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) {
    throw new Error("Acoustic service must use HTTPS outside loopback");
  }
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "caller-recording.wav");
  if (callerChannel !== undefined) form.set("caller_channel", String(callerChannel));
  if (segments.length) form.set("speaker_segments", JSON.stringify(segments));
  const key = process.env.ACOUSTIC_API_KEY?.trim();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) && !key) throw new Error("A private key is required for a remote acoustic service");
  const response = await fetch(new URL("/analyze", base), {
    method: "POST", body: form, headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(120_000), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error(`Acoustic service request failed (${response.status})`);
  return AcousticResponse.parse(await response.json());
}
