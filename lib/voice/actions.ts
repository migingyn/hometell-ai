import { createHash } from "node:crypto";
import { z } from "zod";
import { createPhoneCall, getPhoneCall } from "../retell";
import { supabaseAdmin } from "../supabase";
import type { VoiceCallContext } from "./types";

const Contacts = z.array(z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  description: z.string().max(300).optional(),
})).max(100);

export function approvedContacts() {
  const raw = process.env.VOICE_OUTBOUND_CONTACTS;
  if (!raw) return [];
  const contacts = Contacts.parse(JSON.parse(raw));
  if (new Set(contacts.map((c) => c.id)).size !== contacts.length) {
    throw new Error("VOICE_OUTBOUND_CONTACTS contains duplicate IDs");
  }
  return contacts;
}

export type VoiceAction = {
  id: string;
  parent_call_id: string;
  contact_id: string;
  purpose: string;
  external_call_id: string | null;
  status: "dispatching" | "queued" | "completed" | "failed" | "unknown";
  result: unknown;
};

export type ActionStore = {
  claim: (input: { parentCallId: string; requestKey: string; contactId: string; purpose: string }) => Promise<{ created: boolean; action: VoiceAction }>;
  find: (actionId: string, parentCallId: string) => Promise<VoiceAction | null>;
  update: (actionId: string, patch: Partial<VoiceAction>) => Promise<void>;
};

const store: ActionStore = {
  async claim(input) {
    const { data, error } = await supabaseAdmin().rpc("claim_voice_action", {
      p_parent_call_id: input.parentCallId, p_request_key: input.requestKey,
      p_contact_id: input.contactId, p_purpose: input.purpose,
    });
    if (error || !data) throw new Error("Cannot reserve outbound call. Check voice-actions.sql and the five-call limit.");
    return data as { created: boolean; action: VoiceAction };
  },
  async find(actionId, parentCallId) {
    const { data, error } = await supabaseAdmin().from("voice_actions").select("*")
      .eq("id", actionId).eq("parent_call_id", parentCallId).maybeSingle();
    if (error) throw new Error("Cannot read outbound call status");
    return data as VoiceAction | null;
  },
  async update(actionId, patch) {
    let query = supabaseAdmin().from("voice_actions").update(patch).eq("id", actionId);
    // A fast terminal webhook may arrive before the create-call response. A
    // subsequent queue/uncertainty write must never erase the finished result.
    if (patch.status === "queued" || patch.status === "unknown") {
      query = query.in("status", ["dispatching", "queued", "unknown"]);
    }
    const { error } = await query;
    if (error) throw new Error("Cannot save outbound call status");
  },
};

type ActionDependencies = { store?: ActionStore; dial?: typeof createPhoneCall; getCall?: typeof getPhoneCall };

export async function callContact(
  input: { contactId: string; purpose: string; callerConfirmed: boolean },
  context: VoiceCallContext,
  deps: ActionDependencies = {},
) {
  if (process.env.MOCK_RETELL === "true") throw new Error("Live outbound calls require MOCK_RETELL=false");
  if (context.delegationDepth > 0) throw new Error("Delegated calls cannot place further calls");
  if (!input.callerConfirmed) throw new Error("Ask the caller to confirm the contact and purpose first");
  const contact = approvedContacts().find((c) => c.id === input.contactId);
  if (!contact) throw new Error("Contact is not in the approved directory");
  const purpose = input.purpose.trim();
  if (!purpose || purpose.length > 1000) throw new Error("A brief specific purpose is required");
  const repository = deps.store ?? store;
  const requestKey = createHash("sha256").update(`${contact.id}\n${purpose.toLowerCase().replace(/\s+/g, " ")}`).digest("hex");
  const claim = await repository.claim({ parentCallId: context.callId, requestKey, contactId: contact.id, purpose });
  if (!claim.created) return actionView(claim.action);

  let callId: string;
  try {
    const placed = await (deps.dial ?? createPhoneCall)({
      toNumber: contact.phone,
      agentId: process.env.RETELL_DELEGATE_AGENT_ID || process.env.RETELL_AGENT_ID,
      idempotencyKey: claim.action.id,
      metadata: { voice_action_id: claim.action.id, parent_call_id: context.callId, delegation_depth: 1 },
      dynamicVariables: { call_role: "delegate", voice_task: purpose },
      beginMessage: `Hello, I'm an automated assistant calling on behalf of Heartbeat. I am calling to ask: ${purpose}`,
    });
    callId = placed.callId;
  } catch {
    // A network failure may occur after the provider accepted the call. Preserve
    // the claim and never automatically retry an uncertain telephone action.
    await repository.update(claim.action.id, { status: "unknown" }).catch(() => undefined);
    return { actionId: claim.action.id, status: "unknown", message: "The call request could not be confirmed. Do not place a duplicate call." };
  }
  try {
    await repository.update(claim.action.id, { external_call_id: callId, status: "queued" });
  } catch {
    return { actionId: claim.action.id, status: "unknown", message: "The provider accepted the call, but its status could not be saved. Do not place a duplicate call." };
  }
  return { actionId: claim.action.id, status: "queued", message: `The call to ${contact.name} was accepted. The recipient has not provided an answer yet.` };
}

export async function getCallResult(actionId: string, context: VoiceCallContext, deps: ActionDependencies = {}) {
  const repository = deps.store ?? store;
  const action = await repository.find(actionId, context.callId);
  if (!action) throw new Error("No outbound action with that ID belongs to this call");
  if (!action.external_call_id || action.status === "completed" || action.status === "failed") return actionView(action);
  const remote = await (deps.getCall ?? getPhoneCall)(action.external_call_id);
  if (remote.metadata?.parent_call_id !== context.callId || remote.metadata?.voice_action_id !== action.id) {
    throw new Error("Outbound call ownership could not be verified");
  }
  const terminal = ["ended", "error", "not_connected"].includes(remote.call_status ?? "");
  const status = remote.call_status === "ended" ? "completed" : terminal ? "failed" : "queued";
  const result = {
    callStatus: remote.call_status,
    summary: remote.call_analysis?.call_summary?.slice(0, 1800) ?? null,
    transcript: terminal ? remote.transcript?.slice(0, 3000) ?? null : null,
    limitation: "Recipient statements are reported information. A completed call does not establish that a requested real-world action occurred.",
  };
  await repository.update(action.id, { status, result });
  return actionView({ ...action, status, result });
}

function actionView(action: VoiceAction) {
  return {
    actionId: action.id, status: action.status, result: action.result,
    message: action.status === "completed" ? "The call ended; use only the returned recipient information."
      : "The task has not been confirmed complete. Check status again; do not invent an answer.",
  };
}
