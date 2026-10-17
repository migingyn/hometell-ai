// Demo fallback. Runs the next ladder step right now.
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { advanceCheck, getCheckWithClient } from "@/lib/checks";

const Params = z.object({ checkId: z.string().uuid() });

export async function POST(_req: Request, ctx: RouteContext<"/api/ladder/advance/[checkId]">) {
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return fail("checkId must be a uuid");

  try {
    const check = await getCheckWithClient(parsed.data.checkId);
    if (!check) return fail("Unknown check", 404);
    if (check.status !== "no_answer") return fail(`Ladder only runs on no_answer, check is ${check.status}`, 409);

    const updated = await advanceCheck(check);
    if (!updated) return fail("Check changed, try again", 409);
    return ok({ check: updated });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
