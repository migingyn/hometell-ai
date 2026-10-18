import { timingSafeEqual } from "node:crypto";
import { verifyRetellSignature } from "@/lib/retell";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { evidenceTurns } from "@/lib/demo/evidence";
import { classifyRetellAnalysis } from "@/lib/classifier/retell";
import { assessCallerPriority, callerUtterances } from "@/lib/classifier/priority";
import { reportedRideNeed } from "@/lib/postop/ride";
import { allowedRecordingUrl, readBoundedAudio } from "@/lib/acoustic/recording";
import type { RetellCall } from "@/lib/types";

export class RehearsalError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const RehearsalInput = z.object({
  sessionId: z.string().uuid(), eventId: z.string().uuid(), checkId: z.string().uuid(),
  requestId: z.string().uuid(), confirmed: z.literal(true),
}).strict();
type Input = z.infer<typeof RehearsalInput>;
type Call = RetellCall & { agent_id?: string; recording_url?: string; metadata?: RetellCall["metadata"] & { rehearsal_request_id?: string } };
export type RehearsalRow = {
  request_id: string; session_id: string; event_id: string; check_id: string; agent_id: string;
  call_id: string | null; status: "reserved" | "requested" | "ongoing" | "ended" | "analyzed" | "unknown" | "error";
  turns: { role: "agent" | "user"; content: string }[]; transcript: string | null;
  turn_count: number; recording_available: boolean; updated_at: string; raw: { call?: Call } | null;
  acoustic_status?: VoiceAnalysis["status"];
  acoustic_signal?: "elevated" | "uncertain" | null;
  acoustic_updated_at?: string | null;
  acoustic_attempts?: number;
  acoustic_retry_at?: string | null;
  acoustic_lease_until?: string | null;
};
export type VoiceAnalysis = {
  status: "waiting_for_call" | "waiting_for_recording" | "processing" | "available" | "insufficient_audio" | "unavailable";
  signal: "elevated" | "uncertain" | null;
  updatedAt: string | null;
  retryPending: boolean;
};
const E164 = /^\+[1-9]\d{7,14}$/;
const API = "https://api.retellai.com";

export function rehearsalReadiness(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  if (env.HEARTBEAT_REHEARSAL_ENABLED !== "true") missing.push("HEARTBEAT_REHEARSAL_ENABLED=true");
  for (const key of ["RETELL_API_KEY", "RETELL_REHEARSAL_AGENT_ID"]) if (!env[key]?.trim()) missing.push(key);
  for (const key of ["RETELL_FROM_NUMBER", "HEARTBEAT_REHEARSAL_PHONE"]) if (!E164.test(env[key]?.trim() ?? "")) missing.push(key);
  if ((env.HEARTBEAT_REHEARSAL_TOKEN?.length ?? 0) < 24) missing.push("HEARTBEAT_REHEARSAL_TOKEN (24+ characters)");
  if (env.HEARTBEAT_REHEARSAL_PHONE && env.HEARTBEAT_REHEARSAL_PHONE.trim() === env.RETELL_FROM_NUMBER?.trim()) missing.push("HEARTBEAT_REHEARSAL_PHONE must differ from sender");
  if (env.RETELL_REHEARSAL_AGENT_ID && ["RETELL_AGENT_ID", "RETELL_DAILY_AGENT_ID", "RETELL_CRISIS_AGENT_ID"].some((key) => env[key] === env.RETELL_REHEARSAL_AGENT_ID)) {
    missing.push("RETELL_REHEARSAL_AGENT_ID must be a separate rehearsal agent");
  }
  return { configured: missing.length === 0, missing };
}

export function assertPresenterToken(supplied: string | null, expected = process.env.HEARTBEAT_REHEARSAL_TOKEN ?? "") {
  const a = Buffer.from(expected), b = Buffer.from(supplied ?? "");
  if (a.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new RehearsalError("A private presenter token is required to place this teammate call.", 403);
  }
}

async function provider(path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { method: body ? "POST" : "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY?.trim() ?? ""}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  } catch { throw new RehearsalError("Provider response is unconfirmed. Inspect the provider before another attempt.", 502); }
  if (!response.ok) throw new RehearsalError("The provider request could not be confirmed. Check its dashboard.", 502);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new RehearsalError("Invalid provider response.", 502);
  return data as Call;
}

export function rehearsalPhonePayload(input: Input, name: string, env: Record<string, string | undefined> = process.env) {
  return {
    from_number: env.RETELL_FROM_NUMBER?.trim(), to_number: env.HEARTBEAT_REHEARSAL_PHONE?.trim(),
    override_agent_id: env.RETELL_REHEARSAL_AGENT_ID?.trim(), idempotency_key: `heartbeat_rehearsal_${input.requestId}`,
    ...(env.RETELL_REHEARSAL_AGENT_VERSION && /^\d+$/.test(env.RETELL_REHEARSAL_AGENT_VERSION) ? { override_agent_version: Number(env.RETELL_REHEARSAL_AGENT_VERSION) } : {}),
    honor_internal_dnc: true,
    metadata: { rehearsal_request_id: input.requestId, check_id: input.checkId, target: "client", mode: "crisis" },
    retell_llm_dynamic_variables: { name, agency_name: "Heartbeat demo team", mode: "crisis", call_target: "client",
      contact_name: "the demo coordinator", language: "en",
      alert_text: "This is a fictional practice scenario: a wildfire is affecting parts of Altadena. Your care team is checking whether you need help." },
    agent_override: { agent: { max_call_duration_ms: 180_000, pre_session_tools: [], post_session_tools: [],
      webhook_events: ["call_started", "transcript_updated", "call_ended", "call_analyzed"] } },
  };
}

export async function readRehearsal(checkId: string): Promise<RehearsalRow | null> {
  const { data, error } = await supabaseAdmin().from("heartbeat_rehearsals").select("*").eq("check_id", checkId).maybeSingle();
  if (error) throw new RehearsalError("Rehearsal storage is unavailable. Apply the rehearsal evidence migration.", 503);
  return data as RehearsalRow | null;
}

export function publicRehearsal(row: RehearsalRow | null) {
  if (!row) return null;
  return { requestId: row.request_id, callId: row.call_id, status: row.status, updatedAt: row.updated_at,
    turns: row.turns, transcript: row.transcript, recordingAvailable: row.recording_available,
    audioUrl: row.recording_available ? `/api/demo/rehearsal/recording?checkId=${encodeURIComponent(row.check_id)}` : null,
    voiceAnalysis: rehearsalVoiceAnalysis(row), simulated: false as const };
}

export function rehearsalVoiceAnalysis(row: RehearsalRow): VoiceAnalysis {
  const stored = row.acoustic_status ?? "waiting_for_call";
  const status = stored === "waiting_for_call" && ["ended", "analyzed"].includes(row.status) ? "waiting_for_recording" : stored;
  return { status, signal: status === "available" ? row.acoustic_signal ?? "uncertain" : null,
    updatedAt: row.acoustic_updated_at ?? null,
    retryPending: status === "waiting_for_recording" && Boolean(row.acoustic_retry_at) };
}

export async function startRehearsal(input: Input, env: Record<string, string | undefined> = process.env) {
  if (!rehearsalReadiness(env).configured) throw new RehearsalError("The teammate call is not configured yet. No call was placed.", 503);
  const db = supabaseAdmin();
  const { data: claim, error } = await db.rpc("reserve_heartbeat_rehearsal", {
    p_request_id: input.requestId, p_session_id: input.sessionId, p_event_id: input.eventId,
    p_check_id: input.checkId, p_agent_id: env.RETELL_REHEARSAL_AGENT_ID!.trim(),
  });
  if (error) {
    if (error.message.includes("REHEARSAL_CALL_UNCERTAIN")) throw new RehearsalError("A previous teammate call has an unconfirmed outcome. Check and resolve that attempt before starting another. No new call was placed.", 409);
    if (error.message.includes("REHEARSAL_CALL_ACTIVE")) throw new RehearsalError("Another teammate call is active or still being confirmed. Review that call before starting a new one. No new call was placed.", 409);
    if (error.message.includes("REHEARSAL_CALL_COOLDOWN")) throw new RehearsalError("A teammate call just ended. Wait 60 seconds before starting another. No new call was placed.", 409);
    throw new RehearsalError("Complete the sample replay and select an open resident without an existing rehearsal call.", 409);
  }
  if (claim.duplicate) return { duplicate: true, call: publicRehearsal(claim.rehearsal) };
  try {
    const { data: check, error: checkError } = await db.from("checks").select("client:clients(name)").eq("id", input.checkId).single();
    if (checkError) throw new Error("Missing case");
    const client = check.client as unknown as { name: string };
    const call = await provider("/v2/create-phone-call", rehearsalPhonePayload(input, client.name, env));
    if (!call.call_id || typeof call.call_id !== "string" || call.call_id.startsWith("mock_")) throw new Error("Invalid call ID");
    const { data, error: bindError } = await db.rpc("bind_heartbeat_rehearsal", { p_request_id: input.requestId, p_call_id: call.call_id, p_uncertain: false });
    if (bindError) throw new Error("Call binding unavailable");
    return { duplicate: false, call: publicRehearsal(data) };
  } catch {
    await db.rpc("bind_heartbeat_rehearsal", { p_request_id: input.requestId, p_call_id: null, p_uncertain: true });
    throw new RehearsalError("The call request is unconfirmed. It will not be retried automatically; check the provider first.", 502);
  }
}

export function rehearsalFinalResult(call: Call) {
  // Explicitly bypass mock_outcome, even while the surrounding sample replay is mocked.
  const result = classifyRetellAnalysis(call, { mode: "crisis", target: "client" });
  const uncertainEnd = Boolean(call.disconnection_reason && !["user_hangup", "agent_hangup"].includes(call.disconnection_reason)) ||
    ["not_connected", "error"].includes(call.call_status ?? "");
  if (result.status === "no_answer" || uncertainEnd) return { ...result, status: "needs_human", urgency: "urgent", flag_reason: "Teammate call incomplete or unanswered; human review required.", next_action_at: null };
  // A provider label alone is insufficient. Require the participant's own
  // clear wellbeing statement and a complete, supported independent-mobility quote.
  const explicitWellbeing = callerUtterances(call).some((turn) => turn.toLowerCase().replace(/[‘’]/g, "'")
    .split(/[.!;\n]/).some((sentence) => /^(?:i am|i'm|we are|we're) (?:doing )?(?:okay|ok|fine)$/.test(sentence.trim())));
  if (result.status === "ok" && (!explicitWellbeing || reportedRideNeed(call) !== false || result.priority_assessment?.situation !== "routine")) {
    return { ...result, status: "needs_human", urgency: "urgent", flag_reason: "The call did not establish both wellbeing and independent mobility; human review required.", next_action_at: null };
  }
  return { ...result, next_action_at: null };
}

export async function saveRehearsalCall(row: RehearsalRow, event: string, call: Call) {
  if (call.agent_id !== row.agent_id || (row.call_id && row.call_id !== call.call_id) ||
    call.metadata?.rehearsal_request_id !== row.request_id || call.metadata?.check_id !== row.check_id || call.metadata?.target !== "client") {
    throw new RehearsalError("This call does not belong to the rehearsal reservation.", 403);
  }
  const turns = evidenceTurns(call);
  const { error } = await supabaseAdmin().rpc("save_heartbeat_rehearsal_snapshot", {
    p_request_id: row.request_id, p_call_id: call.call_id, p_event: event, p_turns: turns,
    p_transcript: turns.map((turn) => `${turn.role === "agent" ? "Agent" : "User"}: ${turn.content}`).join("\n"),
    p_raw: { event, call }, p_recording: Boolean(call.recording_url || call.recording_multi_channel_url),
    p_priority: event === "transcript_updated" ? assessCallerPriority(call, { mode: "crisis", target: "client" }, "live") : null,
    p_result: event === "call_analyzed" ? rehearsalFinalResult(call) : null,
  });
  if (error) throw new RehearsalError("The rehearsal evidence could not be saved.", 500);
  if ((row.status === "analyzed" || event === "call_analyzed") && (call.recording_url || call.recording_multi_channel_url)) {
    const { error: recordingError } = await supabaseAdmin().rpc("merge_heartbeat_rehearsal_recording", {
      p_request_id: row.request_id, p_call_id: call.call_id, p_call: call,
    });
    if (recordingError) throw new RehearsalError("The rehearsal recording could not be saved. Apply the rehearsal acoustics migration.", 500);
  }
}

/** Called before the ordinary mock-capable webhook. Real rehearsal callbacks always require a signature. */
export async function interceptRehearsalWebhook(raw: string, signature: string | null, onAnalyzed?: (checkId: string) => void): Promise<boolean> {
  let payload: { event?: string; call?: Call };
  try { payload = JSON.parse(raw); } catch { return false; }
  const call = payload?.call;
  if (!call || typeof call.call_id !== "string") return false;
  const requestId = call.metadata?.rehearsal_request_id;
  if (!requestId && call.call_id.startsWith("mock_")) return false;
  const db = supabaseAdmin();
  let query = db.from("heartbeat_rehearsals").select("*");
  if (requestId) {
    if (!z.string().uuid().safeParse(requestId).success) throw new RehearsalError("Invalid rehearsal reservation.");
    query = query.eq("request_id", requestId);
  } else query = query.eq("call_id", call.call_id);
  const { data, error } = await query.maybeSingle();
  if (error && !requestId) return false;
  if (error) throw new RehearsalError("Cannot read rehearsal reservation.", 503);
  if (!data && !requestId) return false;
  const signed = await verifyRetellSignature(raw, signature);
  if (!signed) throw new RehearsalError("A signed provider callback is required for a real rehearsal.", 401);
  if (!data) throw new RehearsalError("Unknown rehearsal reservation.", 404);
  if (!["call_started", "transcript_updated", "call_ended", "call_analyzed"].includes(payload.event ?? "")) return true;
  await saveRehearsalCall(data as RehearsalRow, payload.event!, call);
  if (payload.event === "call_analyzed" || data.status === "analyzed") onAnalyzed?.(data.check_id);
  return true;
}

/** Read-only refresh recovers a missed callback and obtains a fresh recording link. */
export async function refreshRehearsal(row: RehearsalRow): Promise<RehearsalRow> {
  const age = Date.now() - Date.parse(row.updated_at);
  const markUnconfirmed = async () => {
    const { error } = await supabaseAdmin().rpc("bind_heartbeat_rehearsal", { p_request_id: row.request_id, p_call_id: null, p_uncertain: true });
    if (error) throw new RehearsalError("Cannot save unconfirmed call state.", 503);
    return await readRehearsal(row.check_id) ?? row;
  };
  if (!row.call_id && row.status === "reserved" && age > 60_000) return markUnconfirmed();
  if (!row.call_id || !process.env.RETELL_API_KEY || age < 3000 || (row.status === "analyzed" && row.recording_available)) return row;
  let call: Call;
  try { call = await provider(`/v2/get-call/${encodeURIComponent(row.call_id)}`); }
  catch (error) {
    if (row.status === "requested" && age > 60_000) await markUnconfirmed();
    throw error;
  }
  const hasAnalysis = Boolean(call.call_analysis?.call_summary || call.call_analysis?.custom_analysis_data?.client_status);
  const event = hasAnalysis ? "call_analyzed" : ["ended", "not_connected", "error"].includes(call.call_status ?? "") ? "call_ended" : "transcript_updated";
  await saveRehearsalCall(row, event, call);
  return await readRehearsal(row.check_id) ?? row;
}

export async function rehearsalRecording(row: RehearsalRow) {
  if (!row.call_id) throw new RehearsalError("No provider call is attached to this case.", 404);
  const call = await provider(`/v2/get-call/${encodeURIComponent(row.call_id)}`);
  if (call.call_id !== row.call_id || call.agent_id !== row.agent_id || call.metadata?.rehearsal_request_id !== row.request_id) throw new RehearsalError("Recording call binding mismatch.", 403);
  const value = call.recording_url ?? call.recording_multi_channel_url;
  if (!value) throw new RehearsalError("The provider recording is not ready yet.", 404);
  const url = allowedRecordingUrl(value);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const bytes = await readBoundedAudio(response);
  const contentType = response.headers.get("content-type") ?? "audio/wav";
  return { bytes, contentType: contentType.startsWith("audio/") ? contentType : "audio/wav" };
}
