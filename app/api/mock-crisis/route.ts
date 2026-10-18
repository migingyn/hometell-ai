// Demo: starts a crisis run and replays a mix across every resident, 2 to 3 seconds apart.
import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api";
import { runMockCrisis } from "@/lib/mock";
import { CRISIS_TYPES } from "@/lib/types";

const Body = z.object({ crisis_type: z.enum(CRISIS_TYPES).default("heat_wave") });

export async function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;
    return json({ run: await runMockCrisis(body.data.crisis_type) });
  });
}
