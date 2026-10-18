// Retell outbound calls and signed webhook verification. Server only.
import { randomUUID } from "node:crypto";
import Retell from "retell-sdk";
import { config } from "@/lib/config";
import type { CallMetadata, CallTarget, Client, EventMode, HeartbeatEvent } from "@/lib/types";

export type PlaceCallInput = {
  client: Client;
  checkId: string;
  target: CallTarget;
  event?: HeartbeatEvent;
};

export type PlaceCallResult = { callId: string };

export type CreatePhoneCallInput = {
  toNumber: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  dynamicVariables?: Record<string, string>;
  /** Override the primary agent's greeting for an authorized delegated call. */
  beginMessage?: string;
  /** Reuse the same key when retrying the same authorized call. */
  idempotencyKey?: string;
};

export type PhoneCallRecord = {
  call_id: string;
  call_status: string;
  transcript?: string;
  disconnection_reason?: string;
  metadata?: Record<string, unknown>;
  call_analysis?: { call_summary?: string; call_successful?: boolean };
};

const E164 = /^\+[1-9]\d{7,14}$/;
const API = "https://api.retellai.com";
const HEARTBEAT_AGENT_KEYS = ["RETELL_DAILY_AGENT_ID", "RETELL_CRISIS_AGENT_ID", "RETELL_DAILY_KO_AGENT_ID", "RETELL_CRISIS_KO_AGENT_ID"] as const;

/** Heartbeat must never fall through to a generic research or prescription agent. */
export function resolveHeartbeatAgentId(mode: EventMode, language = "en"): string {
  const prefix = mode === "daily" ? "RETELL_DAILY" : "RETELL_CRISIS";
  const baseKey = `${prefix}_AGENT_ID`;
  const baseId = requireEnv(baseKey);
  const koreanKey = `${prefix}_KO_AGENT_ID`;
  const key = language === "ko" && process.env[koreanKey]?.trim() ? koreanKey : baseKey;
  const id = key === baseKey ? baseId : process.env[key]!.trim();
  if (["RETELL_AGENT_ID", ...HEARTBEAT_AGENT_KEYS].some((other) => other !== key && process.env[other]?.trim() === id)) {
    throw new Error(`${key} must identify a separate dedicated check-in agent, not a generic, other mode, or other language agent.`);
  }
  return id;
}

/** Configuration check only. It intentionally excludes private IDs and provider requests. */
export function getHeartbeatCallingReadiness(mode?: EventMode) {
  const missing = ["RETELL_API_KEY", "RETELL_FROM_NUMBER"].filter((key) => !process.env[key]?.trim());
  const invalid: string[] = [];
  for (const item of mode ? [mode] : ["daily", "crisis"] as const) {
    const key = item === "daily" ? "RETELL_DAILY_AGENT_ID" : "RETELL_CRISIS_AGENT_ID";
    if (!process.env[key]?.trim()) { missing.push(key); continue; }
    try {
      resolveHeartbeatAgentId(item);
      if (process.env[item === "daily" ? "RETELL_DAILY_KO_AGENT_ID" : "RETELL_CRISIS_KO_AGENT_ID"]?.trim()) resolveHeartbeatAgentId(item, "ko");
    } catch { invalid.push(`${key}: use separate dedicated agents for each mode/language and the generic agent`); }
  }
  if (process.env.RETELL_FROM_NUMBER?.trim() && !E164.test(process.env.RETELL_FROM_NUMBER.trim())) invalid.push("RETELL_FROM_NUMBER: E.164 required");
  return { configured: !missing.length && !invalid.length, missing, invalid };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env var ${name}. See .env.example.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function retellRequest(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("RETELL_API_KEY")}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Provider errors can echo telephone numbers and request metadata. Do not
    // leak those into tool responses, logs, or the caller's spoken reply.
    throw new Error(`Retell request failed (${response.status}). Check Retell logs and number permissions.`);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("Retell returned an invalid call response."); }
  if (!isRecord(data)) throw new Error("Retell returned an invalid call response.");
  return data;
}

/** Places a real call only. This must never report a mock call as completed work. */
export async function createPhoneCall(input: CreatePhoneCallInput): Promise<PlaceCallResult> {
  if (config.mockRetell) throw new Error("Real phone calls are unavailable while MOCK_RETELL=true.");
  const fromNumber = requireEnv("RETELL_FROM_NUMBER");
  if (!E164.test(fromNumber) || !E164.test(input.toNumber)) {
    throw new Error("Retell phone numbers must use E.164 format.");
  }
  const agentId = input.agentId?.trim() || requireEnv("RETELL_AGENT_ID");
  if (input.idempotencyKey && !/^[A-Za-z0-9_-]{5,255}$/.test(input.idempotencyKey)) {
    throw new Error("A valid Retell idempotency key is required.");
  }
  const data = await retellRequest("/v2/create-phone-call", {
    method: "POST",
    body: JSON.stringify({
      from_number: fromNumber,
      to_number: input.toNumber,
      override_agent_id: agentId,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.dynamicVariables ? { retell_llm_dynamic_variables: input.dynamicVariables } : {}),
      ...(input.beginMessage ? { agent_override: { retell_llm: { begin_message: input.beginMessage } } } : {}),
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      honor_internal_dnc: true,
    }),
  });
  if (typeof data.call_id !== "string" || !data.call_id.trim()) {
    throw new Error("Retell did not return a call ID. Check Retell logs before retrying.");
  }
  return { callId: data.call_id };
}

/** Fetches live provider state, with only fields needed by the caller exposed. */
export async function getPhoneCall(callId: string): Promise<PhoneCallRecord> {
  if (config.mockRetell) throw new Error("Real call status is unavailable while MOCK_RETELL=true.");
  if (!callId.trim() || callId.length > 200) throw new Error("A valid Retell call ID is required.");
  const data = await retellRequest(`/v2/get-call/${encodeURIComponent(callId)}`);
  if (data.call_id !== callId || typeof data.call_status !== "string") {
    throw new Error("Retell returned an invalid call status.");
  }
  const analysis = isRecord(data.call_analysis) ? data.call_analysis : undefined;
  return {
    call_id: data.call_id,
    call_status: data.call_status,
    ...(typeof data.transcript === "string" ? { transcript: data.transcript } : {}),
    ...(typeof data.disconnection_reason === "string" ? { disconnection_reason: data.disconnection_reason } : {}),
    ...(isRecord(data.metadata) ? { metadata: data.metadata } : {}),
    ...(analysis ? {
      call_analysis: {
        ...(typeof analysis.call_summary === "string" ? { call_summary: analysis.call_summary } : {}),
        ...(typeof analysis.call_successful === "boolean" ? { call_successful: analysis.call_successful } : {}),
      },
    } : {}),
  };
}

// Places one outbound call. In MOCK_RETELL mode no call is placed; send the
// result yourself with scripts/fake-webhook.ts.
export async function placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
  const mode = input.event?.type === "daily" ? "daily" : "crisis";
  const metadata: CallMetadata = { check_id: input.checkId, target: input.target, mode };

  if (config.mockRetell) {
    const callId = `mock_${randomUUID()}`;
    return { callId };
  }

  const alertText = input.event?.alert_text ?? "";
  if (mode === "crisis" && !alertText.trim()) {
    throw new Error("A crisis call requires the coordinator's official alert text.");
  }
  const language = input.client.language === "ko" ? "ko" : "en";
  const agentId = resolveHeartbeatAgentId(mode, language);
  return createPhoneCall({
    toNumber: toNumber(input),
    agentId,
    metadata,
    dynamicVariables: {
      name: input.client.name,
      agency_name: config.agencyName,
      mode,
      alert_text: alertText,
      call_target: input.target,
      contact_name: input.client.emergency_contact_name,
      language,
    },
  });
}

// Places calls in the given order (caller sorts red, yellow, green).
export async function placeCallsInOrder(inputs: PlaceCallInput[]): Promise<PlaceCallResult[]> {
  const results: PlaceCallResult[] = [];
  for (const input of inputs) results.push(await placeCall(input));
  return results;
}

// Checks the x-retell-signature header.
export async function verifyWebhook(rawBody: string, signature: string | null): Promise<boolean> {
  // This bypass exists only for the original explicit mock-call workflow.
  // Live tool endpoints must verify with Retell.verify directly, in every mode.
  if (config.mockRetell) return true;
  if (!signature || !process.env.RETELL_API_KEY?.trim()) return false;
  try {
    return await Retell.verify(rawBody, process.env.RETELL_API_KEY.trim(), signature);
  } catch {
    return false;
  }
}

function toNumber(input: PlaceCallInput): string {
  return input.target === "client" ? input.client.phone : input.client.emergency_contact_phone;
}
