// Retell outbound calls and signature checks. Owner: Mikey.
import { randomUUID } from "node:crypto";
import Retell from "retell-sdk";
import { createAlert, crisisNoResponseMessage } from "@/lib/alerts";
import { config } from "@/lib/config";
import { getCall, getClient, getTodayEntry, listCalls, stripRaw } from "@/lib/db";
import { publish, pushClientStatus, pushCrisis, pushQuietly } from "@/lib/events";
import { supabaseAdmin } from "@/lib/supabase";
import { vitalsStatus } from "@/lib/vitals";
import type { CallMetadata, CallType, CrisisType, RetellCall } from "@/lib/types";

let retellClient: Retell | null = null;
export function retell(): Retell {
  if (!config.retellApiKey) throw new Error("Missing RETELL_API_KEY");
  return (retellClient ??= new Retell({ apiKey: config.retellApiKey }));
}

// Checks x-retell-signature against the exact raw body. Retell.verify needs the raw text,
// not JSON.stringify(req.body), or whitespace and key order break the HMAC.
export async function verifyRetellSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (config.skipSignatureCheck) {
    console.warn("[retell] SKIP_SIGNATURE_CHECK=true, not checking signature. Local testing only.");
    return true;
  }
  if (!signature || !config.retellApiKey) return false;
  return Retell.verify(rawBody, config.retellApiKey, signature);
}

// Ids we made ourselves never exist in Retell.
export function isRealCallId(callId: string): boolean {
  return !callId.startsWith("mock_") && !callId.startsWith("failed_");
}

// Reads a call straight from Retell. Used when a webhook may have been missed.
export async function fetchRetellCall(callId: string): Promise<RetellCall | null> {
  if (!isRealCallId(callId) || !config.retellApiKey) return null;
  const call = await retell().call.retrieve(callId);
  return call.call_type === "phone_call" ? (call as RetellCall) : null;
}

// Every variable sent on every call. The agent prompt must use each one as {{name}}.
export const DYNAMIC_VARIABLE_NAMES = [
  "preferred_name",
  "agency_name",
  "aide_name",
  "nurse_name",
  "nurse_phone",
  "call_type",
  "crisis_type",
  "vitals_status",
  "vitals_watch_note",
  "allergies",
  "med_schedule_now",
  "personal_note",
] as const;
type DynamicVariables = Record<(typeof DYNAMIC_VARIABLE_NAMES)[number], string>;

export const E164 = /^\+[1-9]\d{7,14}$/;

// Every dynamic variable is a string. Empty becomes "none", never "".
function str(v: string | null | undefined): string {
  return v && v.trim() ? v.trim() : "none";
}

export type StartCallInput = {
  clientId: number;
  call_type: CallType;
  crisis_type?: CrisisType | null;
  crisis_run_id?: number | null;
  mock?: boolean; // Never dial, even with MOCK_RETELL=false. Used by the demo endpoints.
};

export class NotFoundError extends Error {}

export async function startCall(input: StartCallInput): Promise<{ call_id: string }> {
  const client = await getClient(input.clientId);
  if (!client) throw new NotFoundError(`No client ${input.clientId}`);

  const [entry, recent] = await Promise.all([getTodayEntry(client.id), listCalls({ clientId: client.id, limit: 20 })]);
  const vitals = vitalsStatus(entry, client.vitals_ranges);
  const lastFact = recent.find((c) => c.new_personal_fact)?.new_personal_fact;
  const crisisType = input.call_type === "crisis" ? (input.crisis_type ?? null) : null;

  const dynamicVariables: DynamicVariables = {
    preferred_name: str(client.preferred_name),
    agency_name: str(config.agencyName),
    aide_name: str(client.aide_name),
    nurse_name: str(client.nurse_name),
    nurse_phone: str(config.nursePhone),
    call_type: input.call_type,
    crisis_type: crisisType ?? "none",
    vitals_status: vitals.status,
    vitals_watch_note: str(vitals.note),
    allergies: str(client.allergies),
    med_schedule_now: str(entry?.med_schedule_now),
    personal_note: str([client.personal_note, lastFact].filter((s) => s && s.trim()).join(" Also: ")),
  };
  const metadata: CallMetadata = {
    client_id: client.id,
    call_type: input.call_type,
    crisis_type: crisisType,
    crisis_run_id: input.crisis_run_id ?? null,
  };
  const row = { client_id: client.id, call_type: input.call_type, crisis_type: crisisType, crisis_run_id: metadata.crisis_run_id };

  let callId: string;
  try {
    if (input.mock || config.mockRetell) {
      callId = `mock_${randomUUID()}`;
      console.log(`[retell:mock] ${input.call_type} call ${callId} to room ${client.room}`, dynamicVariables);
    } else {
      if (!E164.test(client.phone)) throw new Error(`Room ${client.room} phone ${client.phone} is not E.164, like +16265551234`);
      if (client.phone.startsWith("+1555")) throw new Error(`Room ${client.room} has a fake 555 number. Set SEED_PHONES and re-seed`);
      const params: Retell.CallCreatePhoneCallParams = {
        from_number: config.retellFromNumber,
        to_number: client.phone,
        override_agent_id: config.retellAgentId,
        retell_llm_dynamic_variables: dynamicVariables,
        metadata,
      };
      callId = (await retell().call.createPhoneCall(params)).call_id;
    }
  } catch (e) {
    // A crisis call that cannot be placed must never be silently skipped.
    if (input.call_type === "crisis") {
      const failedId = `failed_${randomUUID()}`;
      await supabaseAdmin()
        .from("calls")
        .insert({ ...row, call_id: failedId, status: "ended", disconnection_reason: "dial_failed" });
      await createAlert({
        client_id: client.id,
        call_id: failedId,
        type: "crisis_no_response",
        urgency: "now",
        message: crisisNoResponseMessage(client.room),
        quote: `Call could not be placed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    throw e;
  }

  // The webhook may have created the row first. Keep whichever came first.
  const { error } = await supabaseAdmin()
    .from("calls")
    .upsert({ ...row, call_id: callId, status: "registered" }, { onConflict: "call_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  const saved = await getCall(callId);
  if (saved) publish("call", { call: stripRaw(saved) });
  pushQuietly(pushClientStatus(client.id));
  if (input.call_type === "crisis") pushQuietly(pushCrisis());
  return { call_id: callId };
}
