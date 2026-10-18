// Runs one watchdog pass now. The loop in instrumentation.ts runs it every 30 seconds.
import { handle, json } from "@/lib/api";
import { watchdogTick } from "@/lib/watchdog";

export async function POST() {
  return handle(async () => json(await watchdogTick()));
}
