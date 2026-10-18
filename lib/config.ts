// Env config in one place. Server only: never import from a client component.

export const config = {
  mockRetell: process.env.MOCK_RETELL === "true",
  skipSignatureCheck: process.env.SKIP_SIGNATURE_CHECK === "true",
  retellApiKey: process.env.RETELL_API_KEY ?? "",
  // Retell signs webhooks with the API key that has the webhook badge in the dashboard,
  // which may not be the key used for calls.
  retellWebhookKey: process.env.RETELL_WEBHOOK_KEY || process.env.RETELL_API_KEY || "",
  retellAgentId: process.env.RETELL_AGENT_ID || "agent_88c42c8831666ec6ef1a5b127b",
  retellFromNumber: process.env.RETELL_FROM_NUMBER || "+16264635691",
  agencyName: process.env.AGENCY_NAME || "Sunrise Home Care",
  openLineMinutes: Number(process.env.OPEN_LINE_MINUTES) || 4,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  twilio: {
    sid: process.env.TWILIO_ACCOUNT_SID ?? "",
    token: process.env.TWILIO_AUTH_TOKEN ?? "",
    from: process.env.TWILIO_FROM_NUMBER ?? "",
  },
  frontDeskPhone: process.env.FRONT_DESK_PHONE ?? "",
  // The agent's transfer_to_nurse tool dials {{nurse_phone}}. Falls back to the front desk.
  nursePhone: process.env.NURSE_PHONE || process.env.FRONT_DESK_PHONE || "",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
};

// A crisis call that never reaches call_started this long after we register it counts as no response.
export const NEVER_STARTED_MS = 90 * 1000;

// Today's date in the server's local time zone, as YYYY-MM-DD.
export function today(d = new Date()): string {
  return d.toLocaleDateString("en-CA");
}
