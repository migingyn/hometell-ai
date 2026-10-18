// Handles Retell call events and the flag_nurse function. Owner: Mikey.
// Shared by POST /retell-webhook and the mock endpoints, so the demo runs the real code.
// Idempotent: calls are keyed by call_id and alerts dedupe on call_id + type.
import { ackAlert, createAlert, crisisNoResponseMessage } from "@/lib/alerts";
import { dangerWordIn } from "@/lib/classifier/hardRules";
import { config } from "@/lib/config";
import { getCall, getClient, getTodayEntry, listAlertsForCalls, stripRaw } from "@/lib/db";
import { publish, pushClientStatus, pushCrisis, pushQuietly } from "@/lib/events";
import { supabaseAdmin } from "@/lib/supabase";
import type { Call, CallAnalysis, Client, DisconnectionReason, RetellCall, RetellWebhookPayload, Urgency } from "@/lib/types";

// retell-sdk disconnection_reason values that mean nobody picked up. Typed, so a typo fails tsc.
const NOT_CONNECTED = new Set<DisconnectionReason>([
  "dial_no_answer",
  "dial_busy",
  "dial_failed",
  "voicemail_reached",
  "user_declined",
  "invalid_destination",
  "registered_call_timeout",
  "error_user_not_joined",
  "marked_as_spam",
  "telephony_provider_unavailable",
  "sip_routing_error",
]);
// Reasons that mean the resident may have gone silent on an open line.
const OPEN_LINE_REASONS = new Set<DisconnectionReason>(["inactivity", "max_duration_reached"]);

export async function handleRetellEvent(payload: RetellWebhookPayload): Promise<void> {
  const call = payload.call;
  if (!call?.call_id) return;
  const row = await ensureCallRow(call);
  if (!row) {
    console.warn(`[webhook] ${payload.event} for unknown call ${call.call_id} with no client_id in metadata`);
    return;
  }
  const client = await getClient(row.client_id);
  if (!client) return;

  if (payload.event === "call_started") await onStarted(call, row);
  else if (payload.event === "call_ended") await onEnded(call, row, client);
  else if (payload.event === "call_analyzed") await onAnalyzed(payload, row, client);
  else return;

  const fresh = await getCall(call.call_id);
  if (fresh) publish("call", { call: stripRaw(fresh) });
  pushQuietly(pushClientStatus(client.id));
  if (row.call_type === "crisis") pushQuietly(pushCrisis());
}

// Finds the call row, or creates it from metadata if the webhook beat our insert.
async function ensureCallRow(call: RetellCall): Promise<Call | null> {
  const existing = await getCall(call.call_id);
  if (existing) return existing;
  const meta = call.metadata;
  if (!meta?.client_id) return null;
  const { error } = await supabaseAdmin()
    .from("calls")
    .upsert(
      {
        call_id: call.call_id,
        client_id: Number(meta.client_id),
        call_type: meta.call_type === "crisis" ? "crisis" : "daily",
        crisis_type: meta.crisis_type ?? null,
        crisis_run_id: meta.crisis_run_id ?? null,
        status: "registered",
      },
      { onConflict: "call_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
  return getCall(call.call_id);
}

function iso(ms: number | undefined): string {
  return new Date(ms ?? Date.now()).toISOString();
}

async function onStarted(call: RetellCall, row: Call) {
  if (row.status !== "registered") return; // Never move a call backwards
  const { error } = await supabaseAdmin()
    .from("calls")
    .update({ status: "ongoing", started_at: iso(call.start_timestamp) })
    .eq("call_id", row.call_id)
    .eq("status", "registered");
  if (error) throw new Error(error.message);
}

function durationSec(call: RetellCall): number | null {
  if (call.duration_ms != null) return Math.round(call.duration_ms / 1000);
  if (call.start_timestamp && call.end_timestamp) return Math.round((call.end_timestamp - call.start_timestamp) / 1000);
  return null;
}

async function onEnded(call: RetellCall, row: Call, client: Client) {
  const duration = durationSec(call);
  const { error } = await supabaseAdmin()
    .from("calls")
    .update({
      status: row.status === "analyzed" ? "analyzed" : "ended",
      ended_at: iso(call.end_timestamp),
      duration_sec: duration,
      disconnection_reason: call.disconnection_reason ?? null,
      transcript: call.transcript ?? row.transcript,
    })
    .eq("call_id", row.call_id);
  if (error) throw new Error(error.message);

  const reason = call.disconnection_reason;
  if ((reason && NOT_CONNECTED.has(reason)) || call.call_analysis?.in_voicemail) {
    await noAnswerAlert(row, client);
    return;
  }
  const minutes = Math.round((duration ?? 0) / 60);
  if ((reason && OPEN_LINE_REASONS.has(reason)) || (duration ?? 0) > config.openLineMinutes * 60) {
    const why = reason === "inactivity" ? "went silent" : reason === "max_duration_reached" ? "hit max duration" : "ran long";
    await createAlert({
      client_id: client.id,
      call_id: row.call_id,
      type: "open_line",
      urgency: "now",
      message: `Line ${why} after ${minutes} minutes. Resident may need help. Room ${client.room}.`,
    });
  }
}

// Voicemail and no pickup are never "fine". Crisis calls escalate right away.
async function noAnswerAlert(row: Pick<Call, "call_id" | "call_type">, client: Client) {
  if (row.call_type === "crisis") {
    await createAlert({
      client_id: client.id,
      call_id: row.call_id,
      type: "crisis_no_response",
      urgency: "now",
      message: crisisNoResponseMessage(client.room),
    });
  } else {
    await createAlert({
      client_id: client.id,
      call_id: row.call_id,
      type: "no_answer",
      urgency: "today",
      message: "No answer on the daily call.",
    });
  }
}

// --- call_analyzed ---

const yes = (v: unknown) => v === true || v === "true" || v === "yes";
const no = (v: unknown) => v === false || v === "false" || v === "no";

function bool(v: unknown): boolean | null {
  return yes(v) ? true : no(v) ? false : null;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "_") : "";
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && !["none", "n/a", "null", "unknown"].includes(s.toLowerCase()) ? s : null;
}
function painNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}

// Short or odd answers are data, not errors. Anything we cannot read becomes null.
export function parseAnalysis(d: Record<string, unknown> = {}): CallAnalysis {
  return {
    feels_ok: oneOf(d.feels_ok, ["yes", "no", "unsure"] as const),
    danger_words_heard: bool(d.danger_words_heard),
    med_taken: oneOf(d.med_taken, ["yes", "no", "unsure", "not_asked"] as const),
    allergy_item_mentioned: bool(d.allergy_item_mentioned),
    dose_question_asked: bool(d.dose_question_asked),
    needs_nurse: bool(d.needs_nurse),
    needs_nurse_reason: text(d.needs_nurse_reason),
    new_personal_fact: text(d.new_personal_fact),
    answered_by: oneOf(d.answered_by, ["client", "someone_else", "voicemail", "no_answer"] as const),
    pain_level: painNumber(d.pain_level),
    pain_location: text(d.pain_location),
    sleep_quality: oneOf(d.sleep_quality, ["good", "poor", "not_asked"] as const),
    ate_and_drank: oneOf(d.ate_and_drank, ["yes", "no", "not_asked"] as const),
    steady_on_feet: oneOf(d.steady_on_feet, ["yes", "no", "not_asked"] as const),
    mood: oneOf(d.mood, ["good", "okay", "low", "not_asked"] as const),
    new_swelling: bool(d.new_swelling),
    crisis_status: oneOf(d.crisis_status, ["needs_help", "no_response", "safe", "not_crisis"] as const),
  };
}

async function onAnalyzed(payload: RetellWebhookPayload, row: Call, client: Client) {
  const call = payload.call;
  const analysis = call.call_analysis ?? {};
  const fields = parseAnalysis(analysis.custom_analysis_data);
  const update = {
    ...fields,
    status: "analyzed",
    summary: analysis.call_summary ?? null,
    sentiment: analysis.user_sentiment ?? null,
    call_successful: typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
    transcript: call.transcript ?? row.transcript,
    disconnection_reason: call.disconnection_reason ?? row.disconnection_reason,
    duration_sec: durationSec(call) ?? row.duration_sec,
    started_at: row.started_at ?? (call.start_timestamp ? iso(call.start_timestamp) : null),
    ended_at: row.ended_at ?? (call.end_timestamp ? iso(call.end_timestamp) : null),
    raw_json: payload,
  };
  const { error } = await supabaseAdmin().from("calls").update(update).eq("call_id", row.call_id);
  if (error) throw new Error(error.message);

  const analyzed = { ...row, ...fields, summary: update.summary };
  await analysisAlerts(analyzed, client, dangerWordIn(call));
  await closeCoveredFlags(analyzed);
}

type AnalyzedCall = Pick<Call, "call_id" | "call_type" | "summary"> & CallAnalysis;

// Every alert rule for a finished call. Plain if-statements, no AI.
async function analysisAlerts(c: AnalyzedCall, client: Client, dangerWord: string | null) {
  const base = { client_id: client.id, call_id: c.call_id };
  const alert = (type: Parameters<typeof createAlert>[0]["type"], urgency: Urgency, message: string, quote?: string | null) =>
    createAlert({ ...base, type, urgency, message, quote: quote ?? c.needs_nurse_reason ?? c.summary });
  const unreached = c.answered_by === "voicemail" || c.answered_by === "no_answer";

  if (c.danger_words_heard || dangerWord) {
    const heard = dangerWord ? `Said "${dangerWord}". ` : "";
    await alert("danger", "now", `Danger words heard. ${heard}Check on Room ${client.room} now.`);
  } else if (c.needs_nurse) {
    await alert("needs_nurse", "now", `Needs nurse: ${c.needs_nurse_reason ?? "no reason given"}`);
  }

  if (c.allergy_item_mentioned) {
    await alert("allergy", "now", `Mentioned an allergy item. Allergies: ${client.allergies ?? "none listed"}.`);
  }

  if (c.pain_level != null && c.pain_level >= 4) {
    const where = c.pain_location ? `, ${c.pain_location}` : "";
    await alert("pain", c.pain_level >= 7 ? "now" : "today", `Pain ${c.pain_level}${where}`);
  }

  if (c.call_type === "crisis") {
    if (c.crisis_status === "needs_help") {
      await alert("crisis_needs_help", "now", `CRISIS. Needs help. Send staff to Room ${client.room} now.`);
    } else if (c.crisis_status === "no_response" || unreached) {
      await noAnswerAlert(c, client);
    } else if (c.crisis_status !== "safe") {
      // Answered but we could not tell. Never assume safe.
      await alert("crisis_needs_help", "now", `CRISIS. Status unclear. Check on Room ${client.room} now.`);
    }
  } else if (unreached) {
    await noAnswerAlert(c, client);
  }

  if (c.dose_question_asked) await alert("dose_question", "today", "Asked about a dose. Nurse to call back.");

  if (c.med_taken === "no" || c.med_taken === "unsure") {
    const entry = await getTodayEntry(client.id);
    await alert("missed_med", "today", c.med_taken === "no" ? "Missed meds" : "Unsure about meds", entry?.med_schedule_now);
  }

  const wellness = [
    c.ate_and_drank === "no" && "not eating or drinking",
    c.steady_on_feet === "no" && "not steady on feet",
    c.new_swelling === true && "new swelling",
    c.mood === "low" && "low mood",
    c.sleep_quality === "poor" && "poor sleep",
  ].filter(Boolean) as string[];
  if (wellness.length) {
    const msg = wellness.join(", ");
    await alert("wellness", "today", msg[0].toUpperCase() + msg.slice(1));
  }
}

// The agent calls flag_nurse mid-call for routine items, and the analysis then raises its own
// alert for the same thing. Close the "today" flag when the analysis covers it, so the front
// desk sees each issue once. Urgent flags and anything the analysis did not catch stay open.
const COVERED_BY: { words: RegExp; covered: (c: AnalyzedCall) => boolean }[] = [
  { words: /sleep/i, covered: (c) => c.sleep_quality === "poor" },
  { words: /steady|unsteady|balance/i, covered: (c) => c.steady_on_feet === "no" },
  { words: /swell/i, covered: (c) => c.new_swelling === true },
  { words: /mood|sad|lonely|worried|down/i, covered: (c) => c.mood === "low" },
  { words: /eat|ate|drink|food|water|hungry/i, covered: (c) => c.ate_and_drank === "no" },
  { words: /dose|pill|med/i, covered: (c) => c.med_taken === "no" || c.med_taken === "unsure" || c.dose_question_asked === true },
  { words: /pain|hurt/i, covered: (c) => c.pain_level != null && c.pain_level >= 4 },
];

async function closeCoveredFlags(c: AnalyzedCall) {
  const flags = (await listAlertsForCalls([c.call_id])).filter(
    (a) => a.type === "flag_nurse" && a.urgency === "today" && !a.acknowledged_at,
  );
  for (const flag of flags) {
    if (COVERED_BY.some((rule) => rule.words.test(flag.message) && rule.covered(c))) {
      await ackAlert(flag.id, "Covered by call analysis");
    }
  }
}

// --- flag_nurse custom function ---

export type FlagNurseBody = {
  args?: { reason?: string; urgency?: string; quote?: string };
  call?: RetellCall;
} & { reason?: string; urgency?: string; quote?: string };

// Retell sends { name, args, call }. "Args only" mode sends the args at the top level,
// but then there is no call metadata, so keep that setting off.
export async function handleFlagNurse(body: FlagNurseBody): Promise<void> {
  const args = body.args ?? body;
  const reason = text(args.reason) ?? "Agent flagged the nurse.";
  const urgency: Urgency = args.urgency === "today" ? "today" : "now";
  const call = body.call;
  const row = call?.call_id ? await ensureCallRow(call) : null;
  const clientId = row?.client_id ?? Number(call?.metadata?.client_id);
  const client = clientId ? await getClient(clientId) : null;
  if (!client) {
    console.error("[flag_nurse] no client for this call. Reason was:", reason);
    return;
  }

  const crisisSilent = reason.toUpperCase().startsWith("CRISIS NO RESPONSE");
  await createAlert({
    client_id: client.id,
    call_id: row?.call_id ?? null,
    type: crisisSilent ? "crisis_no_response" : "flag_nurse",
    urgency: crisisSilent ? "now" : urgency,
    message: crisisSilent ? crisisNoResponseMessage(client.room) : reason,
    quote: text(args.quote) ?? (crisisSilent ? reason : null),
    crisis: row?.call_type === "crisis",
  });
}
