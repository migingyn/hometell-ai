// SMS through Twilio. Owner: Fullstack.
import { config } from "@/lib/config";
import type { Client } from "@/lib/types";

export type SmsResult = { id: string };

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  // TODO(Fullstack): send with Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).
  // Keep logging only when MOCK_RETELL=true so the demo never texts by accident.
  console.log(`[sms:fake] to ${to}: ${body}`);
  return { id: "fake_sms" };
}

// Texts the coordinator when a check turns needs_human.
export async function alertCoordinator(client: Client, reason: string): Promise<SmsResult> {
  // TODO(Fullstack): final message copy.
  return sendSms(config.coordinatorPhone, `Heartbeat: ${client.name} needs a human. ${reason}`);
}
