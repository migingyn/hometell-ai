import { z } from "zod";
import { fail } from "@/lib/api";
import { RehearsalError, readRehearsal, rehearsalRecording } from "@/lib/demo/rehearsal";

export const maxDuration = 60;
export async function GET(req: Request) {
  const checkId = new URL(req.url).searchParams.get("checkId");
  if (!z.string().uuid().safeParse(checkId).success) return fail("Select a valid case.");
  try {
    const row = await readRehearsal(checkId!);
    if (!row) return fail("No real rehearsal recording for this case.", 404);
    const audio = await rehearsalRecording(row);
    return new Response(new Uint8Array(audio.bytes), { headers: { "Content-Type": audio.contentType,
      "Content-Length": String(audio.bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return fail(error instanceof RehearsalError ? error.message : "Recording unavailable.", error instanceof RehearsalError ? error.status : 502); }
}
