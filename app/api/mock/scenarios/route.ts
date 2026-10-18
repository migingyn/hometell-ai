// Demo: scenario names for the frontend demo panel.
import { json } from "@/lib/api";
import { SCENARIOS } from "@/lib/mock";

export async function GET() {
  const names = Object.keys(SCENARIOS);
  return json({
    daily: names.filter((n) => SCENARIOS[n].call_type === "daily"),
    crisis: names.filter((n) => SCENARIOS[n].call_type === "crisis"),
  });
}
