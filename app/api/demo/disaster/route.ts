import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { DemoError, getDisasterDemoState, startDisasterDemo, stepDisasterDemo } from "@/lib/demo/disaster";

export const maxDuration = 120;
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), sessionId: z.string().uuid().optional() }),
  z.object({ action: z.literal("step"), sessionId: z.string().uuid(), eventId: z.string().uuid(), step: z.number().int().min(0).max(5) }),
  z.object({ action: z.literal("status"), sessionId: z.string().uuid(), eventId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  let json: unknown;
  try { json = await req.json(); } catch { return fail("Body is not JSON"); }
  const parsed = Input.safeParse(json);
  if (!parsed.success) return fail("Provide a valid replay action and session.");
  try {
    const input = parsed.data;
    return ok(input.action === "start" ? await startDisasterDemo(input.sessionId)
      : input.action === "step" ? await stepDisasterDemo(input.sessionId, input.eventId, input.step)
        : await getDisasterDemoState(input.sessionId, input.eventId));
  } catch (error) {
    return fail(error instanceof DemoError ? error.message : "The simulated replay could not be saved.", error instanceof DemoError ? error.status : 500);
  }
}
