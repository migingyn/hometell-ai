import { supabaseAdmin } from "@/lib/supabase";
import type { PostOpAssessment } from "./types";

/** Compare with the most recent earlier daily event, not a later nurse edit. */
export async function previousPostOpAssessment(clientId: string, eventStartedAt: string): Promise<PostOpAssessment | null> {
  const { data, error } = await supabaseAdmin().from("checks")
    .select("postop_assessment,event:events!inner(type,started_at)")
    .eq("client_id", clientId).eq("event.type", "daily")
    .lt("event.started_at", eventStartedAt).not("postop_assessment", "is", null)
    .order("event(started_at)", { ascending: false }).limit(1);
  if (error) throw new Error("Cannot load the previous post-operative check-in.");
  const assessment = data?.[0]?.postop_assessment as PostOpAssessment | undefined;
  return assessment?.version === 1 ? assessment : null;
}
