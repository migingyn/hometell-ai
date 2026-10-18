// Starts a crisis run and calls every resident, highest vitals risk first, about 2 seconds apart.
import { after } from "next/server";
import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api";
import { callEveryone, openCrisisRun } from "@/lib/crisis";
import { CRISIS_TYPES } from "@/lib/types";

const Body = z.object({ crisis_type: z.enum(CRISIS_TYPES) });

export async function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;
    const run = await openCrisisRun(body.data.crisis_type);
    after(() => callEveryone(run));
    return json({ run });
  });
}
