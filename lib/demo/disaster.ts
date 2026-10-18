import { createHash, randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase";
import { classifyCall } from "@/lib/classifier";
import { applyCallResult, runLadderStep } from "@/lib/ladder";
import { buildPostOpAssessment } from "@/lib/postop/assessment";
import { POSTOP_FIELDS } from "@/lib/postop/types";
import type { Check, Client, EventMode, RetellCall } from "@/lib/types";

export const DISASTER_DEMO_LABELS = [
  "Agency check-ins are calling twenty enrolled patients",
  "Calm danger leads the queue; distress stays separate",
  "Existing ride and powered-equipment needs become actionable",
  "One patient is unanswered; three more report their circumstances",
  "Retry and text are unconfirmed; the emergency contact is called",
  "Human handoff ready; unreachable patient remains flagged",
] as const;
const PREFIX = "SIMULATED DISASTER REPLAY";
const MARKER = "disaster_demo_step_complete";
export class DemoError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function assertLocalDemo() {
  let url: URL;
  try { url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""); }
  catch { throw new DemoError("A local Supabase connection is required for this simulation.", 503); }
  if (!config.mockRetell || process.env.MOCK_RETELL !== "true" || url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new DemoError("This replay requires MOCK_RETELL=true and local Supabase. No calls or messages were placed.", 403);
  }
}

function id(session: string, name: string) {
  const hex = createHash("sha256").update(`heartbeat-disaster-demo-v1:${session}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function ids(session: string) {
  return { event: id(session, "crisis"), daily: id(session, "daily"),
    clients: Array.from({ length: PEOPLE.length }, (_, index) => id(session, `patient:${index}`)),
    checks: Array.from({ length: PEOPLE.length }, (_, index) => id(session, `crisis-check:${index}`)),
    baseline: Array.from({ length: PEOPLE.length }, (_, index) => id(session, `daily-check:${index}`)) };
}
const PEOPLE = [
  { name: "Evelyn Brooks", risk_tier: "red", lives_alone: true, uses_powered_equipment: false, needs_ride: true, lat: 34.1902, lng: -118.1518 },
  { name: "Marcus Reed", risk_tier: "green", lives_alone: false, uses_powered_equipment: false, needs_ride: false, lat: 34.1870, lng: -118.1471 },
  { name: "Rosa Alvarez", risk_tier: "yellow", lives_alone: true, uses_powered_equipment: false, needs_ride: true, lat: 34.1940, lng: -118.1459 },
  { name: "Daniel Kim", risk_tier: "red", lives_alone: true, uses_powered_equipment: true, needs_ride: true, lat: 34.1971, lng: -118.1538 },
  { name: "Harold Chen", risk_tier: "red", lives_alone: true, uses_powered_equipment: false, needs_ride: true, lat: 34.1920, lng: -118.1578 },
  { name: "Patricia Coleman", risk_tier: "yellow", lives_alone: false, uses_powered_equipment: false, needs_ride: false, lat: 34.1849, lng: -118.1512 },
  { name: "James Wilson", risk_tier: "green", lives_alone: false, uses_powered_equipment: false, needs_ride: false, lat: 34.1900, lng: -118.1417 },
  { name: "Amina Hassan", risk_tier: "yellow", lives_alone: false, uses_powered_equipment: false, needs_ride: false, lat: 34.1991, lng: -118.1476 },
  {"name": "Gloria Martinez", "risk_tier": "yellow", "lives_alone": true, "uses_powered_equipment": false, "needs_ride": true, "lat": 34.1957, "lng": -118.1602},
  {"name": "Thomas Bennett", "risk_tier": "green", "lives_alone": false, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.2006, "lng": -118.1584},
  {"name": "Linda Park", "risk_tier": "yellow", "lives_alone": true, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.1831, "lng": -118.1555},
  {"name": "Samuel Ortiz", "risk_tier": "red", "lives_alone": true, "uses_powered_equipment": true, "needs_ride": true, "lat": 34.2014, "lng": -118.143},
  {"name": "Grace Turner", "risk_tier": "yellow", "lives_alone": true, "uses_powered_equipment": false, "needs_ride": true, "lat": 34.1884, "lng": -118.1624},
  {"name": "Robert Davis", "risk_tier": "green", "lives_alone": false, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.1818, "lng": -118.1464},
  {"name": "Mei Lin", "risk_tier": "yellow", "lives_alone": false, "uses_powered_equipment": false, "needs_ride": true, "lat": 34.1962, "lng": -118.1388},
  {"name": "William Carter", "risk_tier": "green", "lives_alone": false, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.2024, "lng": -118.1517},
  {"name": "Sofia Reyes", "risk_tier": "yellow", "lives_alone": true, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.1853, "lng": -118.1418},
  {"name": "George Adams", "risk_tier": "green", "lives_alone": false, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.193, "lng": -118.165},
  {"name": "Nadia Ahmed", "risk_tier": "yellow", "lives_alone": false, "uses_powered_equipment": false, "needs_ride": false, "lat": 34.1788, "lng": -118.1511},
  {"name": "Helen Morris", "risk_tier": "yellow", "lives_alone": true, "uses_powered_equipment": false, "needs_ride": true, "lat": 34.205, "lng": -118.155},
] satisfies Array<Pick<Client, "name" | "risk_tier" | "lives_alone" | "uses_powered_equipment" | "needs_ride" | "lat" | "lng">>;

export const BACKGROUND_RESPONSES = [
  {
    "text": "I need a ride to leave. My daughter cannot reach me by car.",
    "status": "needs_help"
  },
  {
    "text": "I am at the shelter with my wife. We have food and water.",
    "status": "ok"
  },
  {
    "text": "I am with my neighbor. We can leave together in her car.",
    "status": "ok"
  },
  {
    "text": "The electricity is out and my powered equipment has no backup. I need help leaving.",
    "status": "needs_help"
  },
  {
    "text": "",
    "status": "no_answer"
  },
  {
    "text": "I have reached my son\u2019s home. I have my medications with me.",
    "status": "ok"
  },
  {
    "text": "I need a ride to the shelter. I am waiting with my husband.",
    "status": "needs_help"
  },
  {
    "text": "I am okay. My family is with me and we can leave on our own.",
    "status": "ok"
  },
  {
    "text": "",
    "status": "no_answer"
  },
  {
    "text": "I am at my sister\u2019s house away from the smoke. I have food and water.",
    "status": "ok"
  },
  {
    "text": "I am with my family at the shelter. I have my medications.",
    "status": "ok"
  },
  {
    "text": "I cannot get to the shelter on my own. I need someone to arrange a ride.",
    "status": "needs_help"
  }
] as const;

async function ownedSession(sessionId: string, eventId: string) {
  const expected = ids(sessionId);
  if (eventId !== expected.event) throw new DemoError("This event does not belong to the replay session.", 404);
  const { data, error } = await supabaseAdmin().from("events").select("*").eq("id", eventId).eq("request_id", sessionId).maybeSingle();
  if (error) throw new DemoError("Cannot read the replay session.", 500);
  if (!data || data.type !== "crisis" || !data.alert_text?.startsWith(`${PREFIX} [${sessionId}]`)) throw new DemoError("Unknown replay session.", 404);
  return { ...expected, eventRecord: data };
}

async function state(sessionId: string, eventId: string) {
  const own = await ownedSession(sessionId, eventId);
  const { data, error } = await supabaseAdmin().from("call_logs").select("raw")
    .eq("check_id", own.checks[0]).eq("outcome", MARKER);
  if (error) throw new DemoError("Cannot read replay progress.", 500);
  const completed = (data ?? []).map((row) => row.raw?.step).filter((step): step is number => Number.isInteger(step));
  const step = completed.length ? Math.max(...completed) : -2;
  return { sessionId, eventId, dailyEventId: own.daily, step, totalSteps: DISASTER_DEMO_LABELS.length,
    label: step < 0 ? "Prior care records and evacuation needs are ready" : DISASTER_DEMO_LABELS[step],
    done: step === DISASTER_DEMO_LABELS.length - 1, simulated: true as const, patientCount: PEOPLE.length,
    focusClientId: own.clients[step < 0 ? 0 : [0, 0, 2, 4, 4, 0][step]] };
}

async function markStep(sessionId: string, step: number) {
  const own = ids(sessionId);
  const { error } = await supabaseAdmin().from("call_logs").upsert({
    check_id: own.checks[0], retell_call_id: `mock_demo_${sessionId}_step_${step}`,
    target: "client", outcome: MARKER, transcript: null,
    raw: { simulated: true, sessionId, step, kind: "replay_progress" },
  }, { onConflict: "retell_call_id", ignoreDuplicates: true });
  if (error) throw new DemoError("Cannot save replay progress.", 500);
}

async function locked<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("events").update({ dispatching: true })
    .eq("id", ids(sessionId).event).eq("request_id", sessionId).eq("dispatching", false).select("id");
  if (error) throw new DemoError("Cannot reserve this replay step.", 500);
  if (!data?.length) throw new DemoError("Another replay step is still saving. Retry shortly.", 409);
  try { return await operation(); }
  finally { await db.from("events").update({ dispatching: false }).eq("id", ids(sessionId).event).eq("request_id", sessionId); }
}

function callId(session: string, patient: number, attempt = "initial") { return `mock_demo_${session}_${patient}_${attempt}`; }

async function check(id: string): Promise<Check> {
  const { data, error } = await supabaseAdmin().from("checks").select("*").eq("id", id).single();
  if (error || !data) throw new DemoError("A replay patient record is missing.", 500);
  return data as Check;
}

async function saveCall(call: RetellCall, mode: EventMode, patientName: string, recordedAt?: string) {
  const current = await check(call.metadata!.check_id);
  const target = call.metadata!.target;
  let result = await classifyCall(call, { mode, target });
  const postop = mode === "daily" ? buildPostOpAssessment(call, { mode, target, patientName }, null, recordedAt) : null;
  if (postop && result.status === "ok") result = { ...result, status: "needs_human", urgency: "follow_up", flag_reason: "SIMULATED post-operative record awaits nurse review." };
  const patch = applyCallResult(current, result, target, call.call_id);
  if (!Object.keys(patch).length) return;
  const { error } = await supabaseAdmin().rpc("apply_heartbeat_result", {
    p_check_id: current.id, p_call_id: call.call_id, p_target: target,
    p_result: { ...result, ...patch, ...(postop ? { postop_assessment: postop } : {}) },
    p_transcript: call.transcript ?? null, p_raw: { event: "call_analyzed", call, simulated: true },
    // Replay advances explicitly. The global ladder must never race it.
    p_next_action_at: null,
  });
  if (error) throw new DemoError("Cannot save the simulated call result. Check the database migrations.", 500);
}

function transcriptCall(session: string, index: number, text: string, data: Record<string, unknown>, options: { daily?: boolean; attempt?: string; contact?: boolean; noAnswer?: boolean } = {}): RetellCall {
  const own = ids(session);
  const mode = options.daily ? "daily" : "crisis";
  const target = options.contact ? "emergency_contact" : "client";
  const turns = options.noAnswer ? [] : [
    { role: "agent", content: `This is a simulated Heartbeat ${mode} check-in. Is this ${PEOPLE[index].name}?` },
    { role: "user", content: "Yes." },
    { role: "agent", content: mode === "daily" ? "Please report your post-operative check-in answers and whether you need a ride to leave." : "Are you okay right now? Can you leave on your own?" },
    { role: "user", content: text },
  ];
  return { call_id: callId(session, index, options.attempt ?? (options.daily ? "daily" : "initial")),
    call_status: "ended", disconnection_reason: options.noAnswer ? "dial_no_answer" : "agent_hangup",
    metadata: { check_id: options.daily ? own.baseline[index] : own.checks[index], target, mode },
    transcript_object: turns, transcript: turns.map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.content}`).join("\n"),
    call_analysis: { call_summary: `SIMULATED: ${options.noAnswer ? "No answer was received." : text}`, in_voicemail: false, custom_analysis_data: data } };
}

function baselineCall(session: string, index: number): RetellCall {
  const ride = PEOPLE[index].needs_ride ? "I need a ride to leave." : "I can leave on my own.";
  const quotes = { pain: "My pain is 3 out of 10.", incision: "My incision looks dry today.", fever: "My temperature reads 98.6 degrees.",
    breathing: "My breathing feels the same today.", appetite: "I ate breakfast today.", weight: "My weight is 145 pounds today.",
    medications: "I took the medications on my discharge list.", falls: "I did not fall." };
  const call = transcriptCall(session, index, ride, { client_status: "ok", postop_patient_confirmed: true, postop_identity_quote: "Yes.", postop_pain_score: 3,
    needs_ride: PEOPLE[index].needs_ride, needs_ride_quote: ride,
    ...Object.fromEntries(POSTOP_FIELDS.map((field) => [`postop_${field}_quote`, quotes[field]])) }, { daily: true });
  call.transcript_object!.splice(3, 0, ...Object.values(quotes).map((content) => ({ role: "user", content })));
  call.transcript = call.transcript_object!.map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.content}`).join("\n");
  return call;
}

export async function startDisasterDemo(requestedSessionId: string = randomUUID()) {
  assertLocalDemo();
  const sessionId = requestedSessionId;
  const own = ids(sessionId);
  const db = supabaseAdmin();
  const alert = `${PREFIX} [${sessionId}] — Fictional wildfire welfare check in west Altadena. The agency is checking enrolled patients and identifying evacuation assistance needs. This is not a live emergency alert.`;
  const { error: eventError } = await db.from("events").upsert({ id: own.event, request_id: sessionId, type: "crisis", alert_text: alert, dispatching: false }, { onConflict: "id", ignoreDuplicates: true });
  if (eventError) throw new DemoError("Cannot create the replay session.", 500);
  await ownedSession(sessionId, own.event);
  return locked(sessionId, async () => {
    const existing = await state(sessionId, own.event);
    if (existing.step >= -1) return existing;
    const priorAt = new Date(Date.now() - 86_400_000).toISOString();
    const { error: clientError } = await db.from("clients").upsert(PEOPLE.map((person, index) => ({ ...person, id: own.clients[index],
      phone: `+120255501${String(10 + index).padStart(2, "0")}`, emergency_contact_phone: `+120255501${String(30 + index).padStart(2, "0")}`,
      emergency_contact_name: `Fictional replay contact [${sessionId}]`, language: "en", last_daily_at: priorAt,
    })), { onConflict: "id", ignoreDuplicates: true });
    if (clientError) throw new DemoError("Cannot create the fictional replay patients.", 500);
    const { error: priorError } = await db.from("events").upsert({ id: own.daily, type: "daily", started_at: priorAt, alert_text: `${PREFIX} [${sessionId}] — prior daily care record` }, { onConflict: "id", ignoreDuplicates: true });
    if (priorError) throw new DemoError("Cannot save prior care context.", 500);
    const { error: checksError } = await db.from("checks").upsert(PEOPLE.flatMap((_, index) => [
      { id: own.checks[index], event_id: own.event, client_id: own.clients[index], status: "queued", ladder_step: 0, next_action_at: null, summary: "SIMULATED: Waiting for the agency's crisis check-in." },
      { id: own.baseline[index], event_id: own.daily, client_id: own.clients[index], status: "calling", ladder_step: 0, next_action_at: null, last_call_id: callId(sessionId, index, "daily") },
    ]), { onConflict: "id", ignoreDuplicates: true });
    if (checksError) throw new DemoError("Cannot create replay check-ins.", 500);
    for (let index = 0; index < PEOPLE.length; index++) {
      await saveCall(baselineCall(sessionId, index), "daily", PEOPLE[index].name, priorAt);
      const { error: reviewError } = await db.rpc("approve_heartbeat_postop_review", { p_check_id: own.baseline[index], p_call_id: callId(sessionId, index, "daily"), p_reviewer: "Simulated agency nurse" });
      if (reviewError) throw new DemoError("Cannot save the simulated prior nurse review.", 500);
      const { error } = await db.from("checks").update({ status: "handled", handled_at: priorAt, next_action_at: null,
        summary: "SIMULATED: Earlier post-op check-in reviewed by the agency nurse.", flag_reason: null, urgency: null,
      }).eq("id", own.baseline[index]).eq("event_id", own.daily);
      if (error) throw new DemoError("Cannot finish prior care context.", 500);
    }
    await markStep(sessionId, -1);
    return state(sessionId, own.event);
  });
}

async function updateReplayCheck(session: string, index: number, patch: Record<string, unknown>) {
  const own = ids(session);
  const { error } = await supabaseAdmin().from("checks").update({ ...patch, next_action_at: null })
    .eq("id", own.checks[index]).eq("event_id", own.event).eq("client_id", own.clients[index]).neq("status", "handled");
  if (error) throw new DemoError("Cannot advance the simulated patient check.", 500);
}

export async function stepDisasterDemo(sessionId: string, eventId: string, requestedStep: number) {
  assertLocalDemo();
  const own = await ownedSession(sessionId, eventId);
  return locked(sessionId, async () => {
    const current = await state(sessionId, eventId);
    if (requestedStep <= current.step) return current;
    if (requestedStep !== current.step + 1 || requestedStep < 0 || requestedStep >= DISASTER_DEMO_LABELS.length) throw new DemoError("Advance one replay step at a time.", 409);
    const save = (index: number, text: string, data: Record<string, unknown>, options: Parameters<typeof transcriptCall>[4] = {}) => saveCall(transcriptCall(sessionId, index, text, data, options), "crisis", PEOPLE[index].name);
    if (requestedStep === 0) {
      for (let index = 0; index < PEOPLE.length; index++) await updateReplayCheck(sessionId, index, { status: "calling", last_call_id: callId(sessionId, index), summary: "SIMULATED: The agency's automated crisis check-in is calling." });
    } else if (requestedStep === 1) {
      await save(0, "I am calm, but I am bleeding heavily and cannot leave the house.", { client_status: "needs_help", request: "I am bleeding heavily and cannot leave the house." });
      await save(1, "I'm panicking, but I am at the shelter and have food and water. I can leave on my own.", { client_status: "ok", reported_distress: "high", distress_evidence_quote: "I'm panicking" });
    } else if (requestedStep === 2) {
      await save(2, "I need a ride to leave. I am waiting at home and cannot get to the shelter on my own.", { client_status: "needs_help", request: "I need a ride to leave." });
      await save(3, "The power is out. My oxygen machine needs power and I need help leaving.", { client_status: "needs_help", request: "My oxygen machine needs power and I need help leaving." });
    } else if (requestedStep === 3) {
      await save(4, "", {}, { noAnswer: true });
      await save(5, "I am okay. I am with my family and I can leave on my own.", { client_status: "ok" });
      await save(6, "I am okay. I am at the shelter and have food and water.", { client_status: "ok" });
      await save(7, "I am okay. I have my medications and I am with my family at the shelter.", { client_status: "ok" });
      for (let extra = 0; extra < BACKGROUND_RESPONSES.length; extra++) {
        const response = BACKGROUND_RESPONSES[extra];
        await save(extra + 8, response.text, response.status === "no_answer" ? {} : {
          client_status: response.status, ...(response.status === "needs_help" ? { request: response.text } : {}),
        }, { noAnswer: response.status === "no_answer" });
      }
    } else if (requestedStep === 4) {
      await updateReplayCheck(sessionId, 4, { status: "calling", ladder_step: 1, last_call_id: callId(sessionId, 4, "retry") });
      await save(4, "", {}, { attempt: "retry", noAnswer: true });
      await updateReplayCheck(sessionId, 4, { status: "calling", ladder_step: 3, last_call_id: callId(sessionId, 4, "contact"),
        sms_status: "text simulated (MOCK MODE; no message sent)", summary: "SIMULATED: Patient retry was unanswered. Text step recorded; emergency-contact call is now awaiting an answer." });
    } else {
      await save(4, "", { contact_confirms_ok: false }, { attempt: "contact", contact: true, noAnswer: true });
      const unanswered = await check(own.checks[4]);
      const fictional = { ...PEOPLE[4], id: own.clients[4], phone: "+12025550114", emergency_contact_phone: "+12025550134", emergency_contact_name: "Fictional contact", usual_pickup_time: null } as Client;
      if (unanswered.status === "no_answer") {
        const patch = await runLadderStep(unanswered, fictional, own.eventRecord, { alertCoordinator: async () => ({ id: null, status: "mock", note: "coordinator alert simulated (MOCK MODE; no message sent)" }) });
        await updateReplayCheck(sessionId, 4, { ...patch, summary: "SIMULATED: Unreachable after the patient retry, text, and emergency-contact attempt. A human must decide the next action." });
      }
      for (const event of ["transfer_started", "transfer_bridged"]) {
        const { error } = await supabaseAdmin().rpc("apply_heartbeat_transfer", { p_check_id: own.checks[0], p_call_id: callId(sessionId, 0), p_event: event });
        if (error) throw new DemoError("Cannot save the simulated human handoff.", 500);
      }
    }
    await markStep(sessionId, requestedStep);
    return state(sessionId, eventId);
  });
}

export async function getDisasterDemoState(sessionId: string, eventId: string) {
  assertLocalDemo();
  return state(sessionId, eventId);
}
