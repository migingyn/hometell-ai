import { fail, ok } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase";
import { DemoError, getDisasterDemoState, stepDisasterDemo } from "@/lib/demo/disaster";
import { RehearsalError, rehearsalReadiness } from "@/lib/demo/rehearsal";
import { PrepareRehearsalInput, assertLocalPresenter, issueRehearsalPermit, normalizeTestPhone } from "@/lib/demo/rehearsal-permit";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    assertLocalPresenter(req);
    const text = await req.text();
    if (text.length > 4096) return fail("Request too large.", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return fail("Expected JSON."); }
    const parsed = PrepareRehearsalInput.safeParse(body);
    if (!parsed.success) return fail("Select a demo resident and enter a test phone number.");
    const input = { ...parsed.data, phone: normalizeTestPhone(parsed.data.phone) };
    const ready = rehearsalReadiness({ ...process.env, HEARTBEAT_REHEARSAL_PHONE: input.phone });
    if (!ready.configured) return fail("Voice service setup needs attention. No call was placed.", 503);
    let demo = await getDisasterDemoState(input.sessionId, input.eventId);
    const db = supabaseAdmin();
    const { data: check, error } = await db.from("checks").select("id,status").eq("id", input.checkId).eq("event_id", input.eventId).maybeSingle();
    if (error) return fail("Cannot read the selected case.", 503);
    if (!check || check.status === "handled") return fail("Select an open resident in this demo.", 409);
    const { data: reserved, error: reservationError } = await db.from("heartbeat_rehearsals").select("request_id").eq("check_id", input.checkId).maybeSingle();
    if (reservationError) return fail("Cannot read call setup.", 503);
    if (reserved) return fail("This resident already has a saved call. Review it or select another resident for the next call.", 409);
    // Finish only fictional steps. This function never invokes a telephone provider.
    while (!demo.done) demo = await stepDisasterDemo(input.sessionId, input.eventId, demo.step + 1);
    const response = ok({ ...issueRehearsalPermit(input), demo, callsPlaced: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return fail(error instanceof RehearsalError || error instanceof DemoError ? error.message : "Could not prepare the call. No phone call was placed.",
      error instanceof RehearsalError || error instanceof DemoError ? error.status : 500);
  }
}
