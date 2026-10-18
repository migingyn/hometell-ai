import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase";
import { evidenceTurns, redactPhoneNumbers } from "@/lib/demo/evidence";
import { callerUtterances } from "@/lib/classifier/priority";
import { reportedRideNeed } from "@/lib/postop/ride";
import type { RetellCall } from "@/lib/types";
import type { PostOpAssessment } from "@/lib/postop/types";
import { readRehearsal, publicRehearsal } from "@/lib/demo/rehearsal";

export async function GET(_req: Request, ctx: RouteContext<"/api/checks/[id]/evidence">) {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await ctx.params);
  if (!parsed.success) return fail("id must be a uuid");
  try {
    const db = supabaseAdmin();
    const { data: current, error } = await db.from("checks").select("id,event_id,client_id,last_call_id").eq("id", parsed.data.id).maybeSingle();
    if (error) return fail("Cannot read this check.", 500);
    if (!current) return fail("Unknown check", 404);
    // Older daily deployments can still read their evidence before the additive migration.
    const rehearsal = await readRehearsal(current.id).catch(() => null);
    const realCall = rehearsal && rehearsal.call_id === current.last_call_id ? publicRehearsal(rehearsal) : null;
    const { data: event, error: eventError } = await db.from("events").select("started_at,alert_text").eq("id", current.event_id).single();
    if (eventError) return fail("Cannot read this check's event.", 500);
    const { data: log, error: logError } = current.last_call_id
      ? await db.from("call_logs").select("retell_call_id,target,created_at,transcript,raw").eq("check_id", current.id).eq("retell_call_id", current.last_call_id).maybeSingle()
      : { data: null, error: null };
    if (logError) return fail("Cannot read the saved call evidence.", 500);
    const storedCall = log?.raw?.call as RetellCall | undefined;
    const turns = realCall?.turns ?? (log ? evidenceTurns(storedCall ?? { call_id: log.retell_call_id, transcript: log.transcript ?? undefined }) : []);
    const { data: prior, error: priorError } = await db.from("checks")
      .select("id,postop_assessment,event:events!inner(type,started_at)")
      .eq("client_id", current.client_id).eq("event.type", "daily").lt("event.started_at", event.started_at)
      .not("postop_assessment", "is", null).order("event(started_at)", { ascending: false }).limit(1);
    if (priorError) return fail("Cannot read prior care evidence.", 500);
    const assessment = prior?.[0]?.postop_assessment as PostOpAssessment | undefined;
    let priorDaily = null;
    if (assessment?.version === 1) {
      const { data: priorLog, error: priorLogError } = await db.from("call_logs").select("raw")
        .eq("check_id", prior![0].id).eq("retell_call_id", assessment.call_id).maybeSingle();
      if (priorLogError) return fail("Cannot read the source of prior planning information.", 500);
      const priorCall = priorLog?.raw?.call as RetellCall | undefined;
      const candidate = priorCall?.call_analysis?.custom_analysis_data?.needs_ride_quote;
      const rideQuote = assessment.patient_confirmed && typeof candidate === "string" && priorCall &&
        reportedRideNeed(priorCall) !== null && callerUtterances(priorCall).some((turn) => turn.trim() === candidate.trim()) ? candidate.trim() : null;
      priorDaily = { callId: assessment.call_id, recordedAt: assessment.recorded_at,
        answers: Object.fromEntries(Object.entries(assessment.answers).map(([field, answer]) => [field, { ...answer,
          value: typeof answer.value === "string" ? redactPhoneNumbers(answer.value) : answer.value,
          quote: answer.quote ? redactPhoneNumbers(answer.quote) : null }])),
        rideQuote: rideQuote ? redactPhoneNumbers(rideQuote) : null };
    }
    return ok({ checkId: current.id, callId: current.last_call_id,
      source: log ? "persisted_call_log" : realCall ? "live_rehearsal" : "none", recordedAt: realCall?.updatedAt ?? log?.created_at ?? null,
      target: realCall ? "client" : log?.target ?? null, turns, transcript: log || realCall ? turns.map((turn) => `${turn.role === "user" ? "Patient / caller" : "Agent"}: ${turn.content}`).join("\n") : null,
      priorDaily, priorDailySimulated: event.alert_text?.startsWith("SIMULATED DISASTER REPLAY") === true,
      callKind: realCall ? "teammate_rehearsal" : event.alert_text?.startsWith("SIMULATED DISASTER REPLAY") || current.last_call_id?.startsWith("mock_") ? "sample" : "agency_call",
      callStatus: realCall?.status ?? null, recordingAvailable: realCall?.recordingAvailable ?? false, audioUrl: realCall?.audioUrl ?? null,
      simulated: realCall ? false : event.alert_text?.startsWith("SIMULATED DISASTER REPLAY") === true || current.last_call_id?.startsWith("mock_") === true });
  } catch { return fail("Cannot load saved call evidence.", 500); }
}
