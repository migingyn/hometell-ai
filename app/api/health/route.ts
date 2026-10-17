import { connection } from "next/server";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase";
import { ok } from "@/lib/api";

export async function GET() {
  await connection();
  let database = false;
  try {
    const { error } = await supabaseAdmin().from("clients").select("id").limit(1);
    database = !error;
  } catch { /* setup state is shown below */ }
  const retellMissing = ["RETELL_API_KEY", "RETELL_FROM_NUMBER"].filter((key) => !process.env[key]?.trim());
  if (!(process.env.RETELL_DAILY_AGENT_ID || process.env.RETELL_AGENT_ID)) retellMissing.push("RETELL_DAILY_AGENT_ID");
  if (!(process.env.RETELL_CRISIS_AGENT_ID || process.env.RETELL_AGENT_ID)) retellMissing.push("RETELL_CRISIS_AGENT_ID");
  const smsMissing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "COORDINATOR_PHONE"].filter((key) => !process.env[key]?.trim());
  return ok({ database, mockMode: config.mockRetell, fictionalData: process.env.FICTIONAL_CLIENTS !== "false",
    retell: { configured: !retellMissing.length, missing: retellMissing },
    sms: { configured: !smsMissing.length, missing: smsMissing },
    note: "Configuration checks do not establish provider connectivity or delivery." });
}
