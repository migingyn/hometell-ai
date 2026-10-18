import { speakerSegments } from "./client";
import type { SpeakerSegment } from "./types";
import type { RetellCall } from "@/lib/types";

export const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
const DOCUMENTED_RECORDING_HOST = "retellai.s3.us-west-2.amazonaws.com";

export class RecordingBindingError extends Error {}
export type RehearsalRecordingBinding = { requestId: string; checkId: string; callId: string; agentId: string };
type BoundCall = RetellCall & { agent_id?: string; metadata?: RetellCall["metadata"] & { rehearsal_request_id?: string } };

export function matchesRehearsalRecording(call: BoundCall | undefined, binding: RehearsalRecordingBinding): boolean {
  return Boolean(call && !binding.callId.startsWith("mock_") && call.call_id === binding.callId &&
    call.agent_id === binding.agentId && call.metadata?.rehearsal_request_id === binding.requestId &&
    call.metadata?.check_id === binding.checkId && call.metadata?.target === "client");
}

/** Exact hosts only: signed links and redirect locations never reach private services. */
export function allowedRecordingUrl(value: string, extraHosts = process.env.RETELL_RECORDING_HOSTS ?? ""): URL {
  const url = new URL(value);
  const hosts = [DOCUMENTED_RECORDING_HOST, ...extraHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)];
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hosts.includes(url.hostname)) {
    throw new Error("Recording host is not approved; configure its exact HTTPS CDN hostname");
  }
  return url;
}

export async function readBoundedAudio(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error("Recording download failed");
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_RECORDING_BYTES) { await response.body.cancel(); throw new Error("Recording is too large"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RECORDING_BYTES) { await reader.cancel(); throw new Error("Recording is too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("Recording is empty");
  const audio = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
  return audio;
}

/** Re-fetch via authenticated Retell API; never trust a browser-supplied recording link. */
export async function getCallerRecording(callId: string, signedWebhook?: RetellCall): Promise<{ bytes: Uint8Array; segments: SpeakerSegment[] }> {
  const key = process.env.RETELL_API_KEY?.trim();
  if (!key || process.env.MOCK_RETELL === "true") throw new Error("A real Retell connection is required for recordings");
  const record = await lookupCall(callId, key);
  return downloadCallerRecording(record, signedWebhook?.call_id === callId ? signedWebhook : undefined);
}

/** The sole mock-mode exception: a server reservation and its authenticated provider record must agree. */
export async function getRehearsalCallerRecording(binding: RehearsalRecordingBinding, verifiedSnapshot?: BoundCall): Promise<{ bytes: Uint8Array; segments: SpeakerSegment[] }> {
  const key = process.env.RETELL_API_KEY?.trim();
  if (!key) throw new Error("A real Retell connection is required for recordings");
  const record = await lookupCall(binding.callId, key);
  if (!matchesRehearsalRecording(record, binding)) throw new RecordingBindingError("Recording call binding mismatch");
  // Only a persisted, previously verified callback for this exact reservation may
  // supply a short-lived URL omitted by provider storage settings.
  return downloadCallerRecording(record, matchesRehearsalRecording(verifiedSnapshot, binding) ? verifiedSnapshot : undefined);
}

async function lookupCall(callId: string, key: string): Promise<BoundCall> {
  const response = await fetch(`https://api.retellai.com/v2/get-call/${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error("Retell recording lookup failed");
  const record = await response.json();
  if (record?.call_id !== callId) throw new RecordingBindingError("Retell returned a different call");
  return record;
}

async function downloadCallerRecording(record: RetellCall, webhook?: RetellCall): Promise<{ bytes: Uint8Array; segments: SpeakerSegment[] }> {
  // basic_attributes_only can omit stored audio on Get Call. Its verified webhook
  // may still contain a short-lived link; keep the same exact-host restrictions.
  const recordingUrl = record.recording_multi_channel_url ?? webhook?.recording_multi_channel_url;
  if (typeof recordingUrl !== "string") {
    throw new Error("Separate-speaker recording unavailable; no mixed-speaker fallback is used");
  }
  const url = allowedRecordingUrl(recordingUrl);
  const recording = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store", redirect: "error" });
  return { bytes: await readBoundedAudio(recording), segments: speakerSegments(record.transcript_object ?? webhook?.transcript_object) };
}
