import { connection } from "next/server";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase";
import { ok } from "@/lib/api";
import { getNurseHandoffReadiness } from "@/lib/retell-handoff";
import { getHeartbeatCallingReadiness } from "@/lib/retell";

export async function GET() {
  await connection();
  let database = false;
  try {
    const { error } = await supabaseAdmin().from("clients").select("id").limit(1).abortSignal(AbortSignal.timeout(5000));
    database = !error;
  } catch { /* setup state is shown below */ }
  const smsMissing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "COORDINATOR_PHONE"].filter((key) => !process.env[key]?.trim());
  return ok({ database, mockMode: config.mockRetell, fictionalData: process.env.FICTIONAL_CLIENTS !== "false",
    retell: getHeartbeatCallingReadiness(),
    nurseHandoff: getNurseHandoffReadiness(),
    sms: { configured: !smsMissing.length, missing: smsMissing },
    note: "Configuration checks do not establish provider connectivity or delivery." });
}
