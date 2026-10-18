import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RehearsalError, RehearsalInput } from "./rehearsal";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const PrepareRehearsalInput = RehearsalInput.omit({ confirmed: true }).extend({ phone: z.string().max(40) }).strict();
const Permit = RehearsalInput.omit({ confirmed: true }).extend({ phone: z.string(), expiresAt: z.number().int() }).strict();
type Binding = z.infer<typeof RehearsalInput>;

/** Local browser setup only. The public callback proxy never forwards this route. */
export function assertLocalPresenter(req: Request) {
  const requestUrl = new URL(req.url);
  const host = req.headers.get("host") ?? requestUrl.host;
  let origin: URL;
  try { origin = new URL(req.headers.get("origin") ?? ""); }
  catch { throw new RehearsalError("Open the rehearsal on this computer to prepare a call.", 403); }
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (!LOOPBACK.has(requestUrl.hostname) || !LOOPBACK.has(origin.hostname) || origin.host !== host ||
      origin.protocol !== requestUrl.protocol || (forwardedHost && forwardedHost !== host) ||
      ![null, "same-origin"].includes(req.headers.get("sec-fetch-site"))) {
    throw new RehearsalError("Call setup is available only from the local Heartbeat page.", 403);
  }
}

export function normalizeTestPhone(value: string): string {
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(phone)) phone = `+1${phone}`;
  else if (/^1\d{10}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new RehearsalError("Enter a 10-digit US number or an international number beginning with + and its country code.");
  return phone;
}

function secret(value: string) {
  if (value.length < 24) throw new RehearsalError("The local call setup needs its server key. No call was placed.", 503);
  return value;
}

export function issueRehearsalPermit(input: z.infer<typeof PrepareRehearsalInput>, key = process.env.HEARTBEAT_REHEARSAL_TOKEN ?? "", now = Date.now()) {
  const value = { ...input, phone: normalizeTestPhone(input.phone), expiresAt: now + 15 * 60_000 };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret(key)).update(`heartbeat-local-call:${payload}`).digest("base64url");
  return { permit: `${payload}.${signature}`, expiresAt: value.expiresAt, recipientLabel: `Phone ending ${value.phone.slice(-4)}` };
}

export function verifyRehearsalPermit(token: string, input: Binding, key = process.env.HEARTBEAT_REHEARSAL_TOKEN ?? "", now = Date.now()) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || token.length > 2000) throw new RehearsalError("Prepare this call again before dialing.", 403);
  const expected = createHmac("sha256", secret(key)).update(`heartbeat-local-call:${payload}`).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new RehearsalError("The prepared call is invalid. Prepare it again.", 403);
  let data: z.infer<typeof Permit>;
  try { data = Permit.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); }
  catch { throw new RehearsalError("The prepared call is invalid. Prepare it again.", 403); }
  if (data.expiresAt <= now || data.expiresAt > now + 15 * 60_000 ||
      (["sessionId", "eventId", "checkId", "requestId"] as const).some(key => data[key] !== input[key])) {
    throw new RehearsalError("Call setup expired or the selected person changed. Prepare this call again.", 403);
  }
  return normalizeTestPhone(data.phone);
}
