// Retell outbound calls. Owner: Mikey.
import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import type { CallMetadata, CallTarget, Client } from "@/lib/types";

export type PlaceCallInput = {
  client: Client;
  checkId: string;
  target: CallTarget;
};

export type PlaceCallResult = { callId: string };

// Places one outbound call. In MOCK_RETELL mode no call is placed; send the
// result yourself with scripts/fake-webhook.ts.
export async function placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
  const metadata: CallMetadata = { check_id: input.checkId, target: input.target };

  if (config.mockRetell) {
    const callId = `mock_${randomUUID()}`;
    console.log(`[retell:mock] call ${callId} to ${toNumber(input)} (${input.target})`, metadata);
    return { callId };
  }

  // TODO(Mikey): POST https://api.retellai.com/v2/create-phone-call with
  // from_number RETELL_FROM_NUMBER, to_number toNumber(input), override_agent_id RETELL_AGENT_ID,
  // metadata, and retell_llm_dynamic_variables { name, agency_name }. Return the real call_id.
  console.warn("[retell] placeCall not built yet, returning fake call id");
  return { callId: `fake_${randomUUID()}` };
}

// Places calls in the given order (caller sorts red, yellow, green).
export async function placeCallsInOrder(inputs: PlaceCallInput[]): Promise<PlaceCallResult[]> {
  // TODO(Mikey): try the Retell batch call API first. If it fails, keep this loop of single calls.
  const results: PlaceCallResult[] = [];
  for (const input of inputs) results.push(await placeCall(input));
  return results;
}

// Checks the x-retell-signature header.
export async function verifyWebhook(rawBody: string, signature: string | null): Promise<boolean> {
  if (config.mockRetell) return true;
  // TODO(Mikey): verify with RETELL_API_KEY (Retell SDK verify helper). Return false on mismatch.
  void rawBody;
  void signature;
  return true;
}

function toNumber(input: PlaceCallInput): string {
  return input.target === "client" ? input.client.phone : input.client.emergency_contact_phone;
}
