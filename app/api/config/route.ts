import { connection } from "next/server";
import { json } from "@/lib/api";
import { config } from "@/lib/config";
import { CRISIS_TYPES } from "@/lib/types";

export async function GET() {
  await connection(); // Read env at request time, not build time
  return json({ agency_name: config.agencyName, crisis_types: CRISIS_TYPES, open_line_minutes: config.openLineMinutes });
}
