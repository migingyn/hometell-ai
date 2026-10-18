// Places one daily or crisis call to a resident.
import { z } from "zod";
import { fail, handle, json, parseBody, parseId } from "@/lib/api";
import { activeCrisisRun } from "@/lib/db";
import { NotFoundError, startCall } from "@/lib/retell";
import { CRISIS_TYPES } from "@/lib/types";

const Body = z.object({
  call_type: z.enum(["daily", "crisis"]).default("daily"),
  crisis_type: z.enum(CRISIS_TYPES).nullable().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/clients/[id]/call">) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    if (!id) return fail("Bad client id");
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;

    // A crisis call joins the active run if there is one.
    const run = body.data.call_type === "crisis" ? await activeCrisisRun() : null;
    try {
      const result = await startCall({
        clientId: id,
        call_type: body.data.call_type,
        crisis_type: body.data.crisis_type ?? run?.crisis_type ?? (body.data.call_type === "crisis" ? "heat_wave" : null),
        crisis_run_id: run?.id ?? null,
      });
      return json(result);
    } catch (e) {
      if (e instanceof NotFoundError) return fail(e.message, 404);
      return fail(`Call failed: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
  });
}
