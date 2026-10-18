// Optional Retell custom function: stored facts about a resident. No inferences. Owner: Mikey.
import { fail, handle, json } from "@/lib/api";
import { getClient, getTodayEntry } from "@/lib/db";
import { verifyRetellSignature } from "@/lib/retell";
import { vitalsStatus } from "@/lib/vitals";

type Body = { client_id?: unknown; args?: { client_id?: unknown }; call?: { metadata?: { client_id?: unknown } } };

export async function POST(req: Request) {
  return handle(async () => {
    const raw = await req.text();
    if (!(await verifyRetellSignature(raw, req.headers.get("x-retell-signature")))) return fail("Bad signature", 401);

    let body: Body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail("Body is not JSON");
    }
    const id = Number(body.args?.client_id ?? body.client_id ?? body.call?.metadata?.client_id);
    const client = id ? await getClient(id) : null;
    if (!client) return fail("Client not found", 404);

    const entry = await getTodayEntry(client.id);
    return json({
      name: client.name,
      preferred_name: client.preferred_name,
      room: client.room,
      allergies: client.allergies ?? "none",
      med_schedule_now: entry?.med_schedule_now ?? "none",
      vitals_status: vitalsStatus(entry, client.vitals_ranges).status,
    });
  });
}
