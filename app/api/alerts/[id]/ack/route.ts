// Front desk acknowledges an alert.
import { z } from "zod";
import { fail, handle, json, parseBody, parseId } from "@/lib/api";
import { ackAlert } from "@/lib/alerts";

const Body = z.object({ by: z.string().trim().min(1, "by is required") });

export async function POST(req: Request, ctx: RouteContext<"/api/alerts/[id]/ack">) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    if (!id) return fail("Bad alert id");
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;
    const alert = await ackAlert(id, body.data.by);
    return alert ? json(alert) : fail("Alert not found", 404);
  });
}
