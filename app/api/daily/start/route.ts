// Starts the daily round: calls every resident not yet called today. Returns before the calls finish.
import { after } from "next/server";
import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api";
import { callDailyRound, planDailyRound } from "@/lib/daily";

const Body = z.object({ force: z.boolean().default(false) });

const brief = (c: { id: number; name: string; room: string }) => ({ client_id: c.id, name: c.name, room: c.room });

export async function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;
    const plan = await planDailyRound(body.data.force);
    after(() => callDailyRound(plan.to_call));
    return json({ calling: plan.to_call.map(brief), skipped: plan.skipped.map(brief) });
  });
}
