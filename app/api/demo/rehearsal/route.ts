import { z } from "zod";
import { after } from "next/server";
import { fail, ok } from "@/lib/api";
import { RehearsalError, RehearsalInput, assertPresenterToken, publicRehearsal, readRehearsal, refreshRehearsal, rehearsalReadiness, startRehearsal } from "@/lib/demo/rehearsal";
import { assertLocalPresenter, verifyRehearsalPermit } from "@/lib/demo/rehearsal-permit";
import { processRehearsalAcoustics, rehearsalAcousticsDue } from "@/lib/demo/rehearsal-acoustic";

export const maxDuration = 240;
export async function GET(req: Request) {
  const checkId = new URL(req.url).searchParams.get("checkId");
  if (!z.string().uuid().safeParse(checkId).success) return fail("Select a valid case.");
  try {
    let row = await readRehearsal(checkId!);
    let refreshPending = false;
    if (row) try { row = await refreshRehearsal(row); } catch {
      refreshPending = true;
      row = await readRehearsal(checkId!).catch(() => row);
    }
    if (row && rehearsalAcousticsDue(row)) after(async () => {
      try { await processRehearsalAcoustics(checkId!); }
      catch { console.warn("Rehearsal voice analysis will recover on a later status refresh."); }
    });
    return ok({ checkId, readiness: rehearsalReadiness(), call: publicRehearsal(row), refreshPending });
  } catch (error) { return fail(error instanceof RehearsalError ? error.message : "Cannot read rehearsal.", error instanceof RehearsalError ? error.status : 500); }
}
export async function POST(req: Request) {
  try {
    const permit = req.headers.get("x-heartbeat-rehearsal-permit");
    if (permit) assertLocalPresenter(req);
    else assertPresenterToken(req.headers.get("x-heartbeat-presenter-token"));
    const text = await req.text();
    if (text.length > 4096) return fail("Request too large.", 413);
    let value: unknown;
    try { value = JSON.parse(text); } catch { return fail("Expected JSON."); }
    const input = RehearsalInput.safeParse(value);
    if (!input.success) return fail("Select one replay case and confirm the teammate agreed to this call.");
    const env = permit ? { ...process.env, HEARTBEAT_REHEARSAL_PHONE: verifyRehearsalPermit(permit, input.data) } : process.env;
    return ok(await startRehearsal(input.data, env));
  } catch (error) { return fail(error instanceof RehearsalError ? error.message : "Cannot start rehearsal.", error instanceof RehearsalError ? error.status : 500); }
}
