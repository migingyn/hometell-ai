// SMS to the front desk through the Twilio REST API. Only runs when the Twilio vars are set.
// Plain fetch, so no Twilio package is needed.
import { config } from "@/lib/config";

export function smsConfigured(): boolean {
  const t = config.twilio;
  return Boolean(t.sid && t.token && t.from && config.frontDeskPhone);
}

export async function sendFrontDeskSms(body: string): Promise<void> {
  if (!smsConfigured()) return;
  const { sid, token, from } = config.twilio;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: config.frontDeskPhone, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}
