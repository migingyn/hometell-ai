// Demo: replays one scenario's Retell events through the real webhook code. No phone call.
import { z } from "zod";
import { fail, handle, json, parseBody } from "@/lib/api";
import { getClient } from "@/lib/db";
import { runScenario, SCENARIO_NAMES } from "@/lib/mock";

const Body = z.object({
  client_id: z.coerce.number().int().positive(),
  scenario: z.string().refine((s) => SCENARIO_NAMES.includes(s), { message: `scenario must be one of ${SCENARIO_NAMES.join(", ")}` }),
});

export async function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;
    if (!(await getClient(body.data.client_id))) return fail("Client not found", 404);
    const call_id = await runScenario(body.data.client_id, body.data.scenario);
    return json({ call_id, scenario: body.data.scenario });
  });
}
