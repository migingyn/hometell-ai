// Retell custom function flag_nurse, called mid-call. Owner: Mikey.
// Answers the agent right away; the alert is saved just after.
import { after } from "next/server";
import { fail, json } from "@/lib/api";
import { verifyRetellSignature } from "@/lib/retell";
import { handleFlagNurse, type FlagNurseBody } from "@/lib/webhook";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyRetellSignature(raw, req.headers.get("x-retell-signature")))) return fail("Bad signature", 401);

  let body: FlagNurseBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("Body is not JSON");
  }

  after(async () => {
    try {
      await handleFlagNurse(body);
    } catch (e) {
      console.error("[flag_nurse] failed", e);
    }
  });
  return json({ result: "Nurse has been alerted." });
}
