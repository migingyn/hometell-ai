import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase";

const Params = z.object({ id: z.string().uuid() });
const Review = z.object({ call_id: z.string().trim().min(1).max(200), reviewer: z.string().trim().min(1).max(100) });

export async function POST(req: Request, ctx: RouteContext<"/api/checks/[id]/postop-review">) {
  const params = Params.safeParse(await ctx.params);
  if (!params.success) return fail("id must be a uuid");
  let json: unknown;
  try { json = await req.json(); } catch { return fail("Body is not JSON"); }
  const parsed = Review.safeParse(json);
  if (!parsed.success) return fail("The current call ID and reviewer's name or initials are required.");
  try {
    // The database locks the check and compares the call ID before approval.
    // This records a review decision; it does not dispatch or resolve the check.
    const { data, error } = await supabaseAdmin().rpc("approve_heartbeat_postop_review", {
      p_check_id: params.data.id, p_call_id: parsed.data.call_id, p_reviewer: parsed.data.reviewer,
    });
    if (error) return fail("Cannot save nurse review. Confirm the post-operative migration is applied.", 500);
    if (data?.skipped) return fail("This check changed or no longer has a reviewable post-operative record. Refresh before reviewing.", data.skipped === "unknown" ? 404 : 409);
    return ok(data);
  } catch { return fail("Cannot save nurse review.", 500); }
}
