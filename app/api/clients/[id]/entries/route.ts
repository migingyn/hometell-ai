// Nurse saves today's vitals, watch note, and med schedule. Saving again replaces today's entry.
import { z } from "zod";
import { fail, handle, json, parseBody, parseId } from "@/lib/api";
import { today } from "@/lib/config";
import { getClient } from "@/lib/db";
import { pushClientStatus, pushQuietly } from "@/lib/events";
import { supabaseAdmin } from "@/lib/supabase";

const num = z.number().nullable().optional();
const Body = z.object({
  bp_sys: num,
  bp_dia: num,
  heart_rate: num,
  temp_f: num,
  spo2: num,
  vitals_watch_note: z.string().nullable().optional(),
  med_schedule_now: z.string().nullable().optional(),
  entered_by: z.string().nullable().optional(),
});

// Blank text is stored as null.
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export async function POST(req: Request, ctx: RouteContext<"/api/clients/[id]/entries">) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    if (!id) return fail("Bad client id");
    const body = await parseBody(req, Body);
    if ("error" in body) return body.error;
    if (!(await getClient(id))) return fail("Client not found", 404);

    const b = body.data;
    const { data, error } = await supabaseAdmin()
      .from("daily_entries")
      .upsert(
        {
          client_id: id,
          date: today(),
          bp_sys: b.bp_sys ?? null,
          bp_dia: b.bp_dia ?? null,
          heart_rate: b.heart_rate ?? null,
          temp_f: b.temp_f ?? null,
          spo2: b.spo2 ?? null,
          vitals_watch_note: clean(b.vitals_watch_note),
          med_schedule_now: clean(b.med_schedule_now),
          entered_by: clean(b.entered_by),
        },
        { onConflict: "client_id,date" },
      )
      .select()
      .single();
    if (error) return fail(error.message, 500);

    pushQuietly(pushClientStatus(id));
    return json(data);
  });
}
