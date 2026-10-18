// Retell webhook: call_started, call_ended, call_analyzed. Owner: Mikey.
// Responds 204 right away and does the work after, so Retell never retries on a slow handler.
import { after } from "next/server";
import { z } from "zod";
import { fail } from "@/lib/api";
import { verifyRetellSignature } from "@/lib/retell";
import type { RetellWebhookPayload } from "@/lib/types";
import { handleRetellEvent } from "@/lib/webhook";

const Payload = z.object({ event: z.string(), call: z.object({ call_id: z.string() }).passthrough() });

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyRetellSignature(raw, req.headers.get("x-retell-signature")))) return fail("Bad signature", 401);

  let parsed;
  try {
    parsed = Payload.safeParse(JSON.parse(raw));
  } catch {
    return fail("Body is not JSON");
  }
  if (!parsed.success) return fail(z.prettifyError(parsed.error));

  const payload = parsed.data as RetellWebhookPayload;
  after(async () => {
    try {
      await handleRetellEvent(payload);
    } catch (e) {
      console.error(`[webhook] ${payload.event} ${payload.call.call_id} failed`, e);
    }
  });
  return new Response(null, { status: 204 });
}
