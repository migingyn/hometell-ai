// Coordinator marks a check resolved.
import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { getCheckWithClient, updateCheck } from "@/lib/checks";

const Params = z.object({ id: z.string().uuid() });

export async function POST(_req: Request, ctx: RouteContext<"/api/checks/[id]/handled">) {
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return fail("id must be a uuid");

  try {
    const check = await getCheckWithClient(parsed.data.id);
    if (!check) return fail("Unknown check", 404);

    const updated = await updateCheck(check.id, {
      status: "handled",
      handled_at: new Date().toISOString(),
      next_action_at: null,
    });
    return ok({ check: updated });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
