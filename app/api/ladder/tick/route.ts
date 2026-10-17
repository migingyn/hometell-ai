// The open dashboard drives follow-up; each action is claimed atomically.
import { fail, ok } from "@/lib/api";
import { advanceCheck } from "@/lib/checks";
import { alertCoordinator } from "@/lib/sms";
import { supabaseAdmin } from "@/lib/supabase";
import type { CheckWithClient } from "@/lib/types";

export async function POST() {
  try {
    const db = supabaseAdmin();
    const staleBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    // An interrupted process may have placed a call before losing its response.
    // Preserve uncertainty and hand off; never blindly redial a claimed action.
    const { data: abandoned, error: abandonedError } = await db.from("checks")
      .update({ status: "needs_human", urgency: "urgent", flag_reason: "Action outcome unknown; coordinator must inspect the provider", next_action_at: null, action_token: null, action_started_at: null })
      .eq("status", "no_answer").not("action_token", "is", null).lt("action_started_at", staleBefore)
      .select("*, client:clients(*)");
    if (abandonedError) return fail(abandonedError.message, 500);
    for (const check of (abandoned ?? []) as CheckWithClient[]) {
      const sms = await alertCoordinator(check.client, check.flag_reason ?? "Follow-up needs review");
      await db.from("checks").update({ sms_status: sms.note }).eq("id", check.id);
    }
    const { data, error } = await db.from("checks").select("*, client:clients(*)")
      .eq("status", "no_answer").lte("next_action_at", new Date().toISOString());
    if (error) return fail(error.message, 500);
    let advanced = 0;
    for (const check of (data ?? []) as CheckWithClient[]) {
      if (await advanceCheck(check)) advanced++;
    }
    return ok({ due: data?.length ?? 0, advanced, recovered: abandoned?.length ?? 0 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Cannot advance follow-up", 500);
  }
}
