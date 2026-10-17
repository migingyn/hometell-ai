import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import type { Client } from "@/lib/types";

export type SmsResult = { id: string | null; status: "sent" | "mock" | "not_configured" | "failed"; note: string };
const E164 = /^\+[1-9]\d{7,14}$/;

/** A provider acceptance is recorded separately from confirmed delivery. Never throws. */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (config.mockRetell) {
    console.log(`[sms:mock] to ${to}: ${body}`);
    return { id: `mock_sms_${randomUUID()}`, status: "mock", note: "text simulated (MOCK MODE; no message sent)" };
  }
  const account = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!account || !token || !from || !to?.trim()) {
    return { id: null, status: "not_configured", note: "text not sent (SMS not configured)" };
  }
  if (!/^AC[0-9a-f]{32}$/i.test(account) || !E164.test(from) || !E164.test(to) || !body.trim() || body.length > 1600) {
    return { id: null, status: "failed", note: "text not sent (invalid SMS destination or configuration)" };
  }
  try {
    // https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!response.ok) return { id: null, status: "failed", note: `text not sent (SMS provider returned HTTP ${response.status})` };
    const data = await response.json() as { sid?: unknown; status?: unknown };
    if (typeof data.sid !== "string" || !data.sid || ["failed", "undelivered", "canceled"].includes(String(data.status))) {
      return { id: null, status: "failed", note: "text not sent (SMS provider did not confirm acceptance)" };
    }
    return { id: data.sid, status: "sent", note: "text accepted by SMS provider (delivery not confirmed)" };
  } catch {
    return { id: null, status: "failed", note: "text status unknown (SMS request could not be confirmed); check the provider before retrying" };
  }
}

export async function alertCoordinator(client: Client, reason: string): Promise<SmsResult> {
  return sendSms(config.coordinatorPhone, `Heartbeat / ${config.agencyName}: ${client.name} needs a human. ${reason}`);
}
