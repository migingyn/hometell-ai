// Actual local HTTP + Supabase checks using isolated, fictional, simulated calls.
// Default cleanup affects only UUIDs created by this run. --keep retains a demo.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../lib/supabase";
import { POSTOP_FIELDS, type PostOpAssessment } from "../lib/postop/types";
import type { ApiResult, Check, RetellCall } from "../lib/types";

const BASE = new URL(process.env.POSTOP_APP_URL ?? "http://127.0.0.1:3018");
const KEEP = process.argv.includes("--keep");
const OUTPUT = resolve("output/postop/verification.json");
const local = (url: URL) => url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password;
const runId = randomUUID();
const primaryName = `Jordan Lee · fictional ${runId.slice(0, 8)}`;
const auxiliaryName = `Verification patient · fictional ${runId.slice(0, 8)}`;
const primaryClientId = randomUUID();
const auxiliaryClientId = randomUUID();
const eventIds = { baseline: randomUUID(), current: randomUUID(), auxiliary: randomUUID(), crisis: randomUUID() };
const checkIds = { baseline: randomUUID(), current: randomUUID(), auxiliary: randomUUID(), crisis: randomUUID() };
const callIds = { baseline: `mock_postop_${randomUUID()}`, current: `mock_postop_${randomUUID()}`, auxiliary: `mock_postop_${randomUUID()}`, crisis: `mock_postop_${randomUUID()}` };
const assertions: string[] = [];
let fixturesCreated = false;

type ApiData = { check?: Check; duplicate?: boolean; skipped?: string; applied?: boolean };
async function request<T>(path: string, body?: unknown): Promise<{ status: number; body: ApiResult<T> }> {
  const response = await fetch(new URL(path, BASE), {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(45_000),
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  let result: ApiResult<T>;
  try { result = await response.json() as ApiResult<T>; }
  catch { throw new Error(`Verification endpoint returned invalid JSON (HTTP ${response.status}).`); }
  return { status: response.status, body: result };
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await request<T>(path, body);
  if (response.status >= 400 || !response.body.ok) throw new Error(`Local endpoint ${path} failed (HTTP ${response.status}). Inspect the local server logs.`);
  return response.body.data;
}

async function readCheck(id: string): Promise<Check> {
  const { data, error } = await supabaseAdmin().from("checks").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Could not read the isolated verification check.");
  return data as Check;
}

function assessment(check: Check): PostOpAssessment {
  assert.ok(check.postop_assessment, "A daily patient call must persist its structured post-op record.");
  return check.postop_assessment;
}

async function webhook(call: RetellCall, event = "call_analyzed"): Promise<ApiData> {
  return api<ApiData>("/api/retell/webhook", { event, call });
}

const standardQuotes = {
  incision: "The incision looks dry, and the dressing is still in place.",
  fever: "My temperature reading is 98.6 degrees today.",
  breathing: "My breathing feels the same as yesterday.",
  appetite: "I ate breakfast and lunch today.",
  weight: "My scale showed 145 pounds this morning.",
  medications: "I took the medications listed on my discharge sheet.",
  falls: "I have stayed steady on my feet today.",
};

function dailyCall(checkId: string, callId: string, score: number, incomplete = false): RetellCall {
  const identity = "Yes.";
  const pain = `My pain is ${score} out of 10 right now.`;
  const quotes = { pain, ...standardQuotes };
  const turns = [identity, pain, ...(incomplete ? [] : Object.values(standardQuotes))];
  const data: Record<string, unknown> = {
    client_status: "ok", postop_patient_confirmed: true, postop_identity_quote: identity,
    postop_pain_score: score, postop_pain_quote: pain,
  };
  if (incomplete) data.postop_fever_quote = "I do not have a fever."; // Deliberately absent from the patient's turns.
  else for (const field of POSTOP_FIELDS) data[`postop_${field}_quote`] = quotes[field];
  const transcriptObject = [
    { role: "agent", content: "SIMULATED post-op agency check-in. Please answer in your own words." },
    // Agent speech must never validate a claimed patient answer.
    ...(incomplete ? [{ role: "agent", content: "I do not have a fever." }] : []),
    { role: "agent", content: `Is this ${checkId === checkIds.baseline || checkId === checkIds.current ? primaryName : auxiliaryName}?` },
    ...turns.map((content) => ({ role: "user", content })),
  ];
  return {
    call_id: callId, call_status: "ended", disconnection_reason: "agent_hangup",
    metadata: { check_id: checkId, target: "client", mode: "daily" },
    transcript_object: transcriptObject,
    transcript: transcriptObject.map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.content}`).join("\n"),
    call_analysis: {
      call_summary: `SIMULATED: Patient reports pain ${score}/10. ${incomplete ? "Other post-op answers were not established." : "Structured answers are ready for nurse review."}`,
      in_voicemail: false, custom_analysis_data: data,
    },
  };
}

async function prepareAuxiliaryCall(): Promise<string> {
  const callId = `mock_postop_${randomUUID()}`;
  const { error } = await supabaseAdmin().from("checks").update({
    status: "calling", ladder_step: 0, last_call_id: callId, handled_at: null, next_action_at: null,
    postop_assessment: null, nurse_transfer: null, priority_assessment: null, acoustic_assessment: null,
    flag_reason: null, summary: null, urgency: null, sms_status: null,
  }).eq("id", checkIds.auxiliary).eq("client_id", auxiliaryClientId);
  if (error) throw new Error("Could not prepare the next isolated mock call.");
  return callId;
}

async function createFixtures() {
  const db = supabaseAdmin();
  fixturesCreated = true;
  const clients = await db.from("clients").insert([
    { id: primaryClientId, name: primaryName, phone: "+12025550120", risk_tier: "yellow", lives_alone: true, uses_powered_equipment: false, emergency_contact_name: "Fictional contact", emergency_contact_phone: "+12025550121", needs_ride: true },
    { id: auxiliaryClientId, name: auxiliaryName, phone: "+12025550122", risk_tier: "green", lives_alone: false, uses_powered_equipment: false, emergency_contact_name: "Fictional contact", emergency_contact_phone: "+12025550123", needs_ride: false },
  ]);
  if (clients.error) throw new Error(`Could not create the isolated fictional patients (${clients.error.code}).`);
  const now = Date.now();
  const events = await db.from("events").insert([
    { id: eventIds.baseline, type: "daily", started_at: new Date(now - 86_400_000).toISOString() },
    { id: eventIds.auxiliary, type: "daily", started_at: new Date(now - 7_200_000).toISOString() },
    { id: eventIds.crisis, type: "crisis", started_at: new Date(now - 3_600_000).toISOString(), alert_text: "FICTIONAL VERIFICATION ALERT. This is a simulated agency welfare check." },
    { id: eventIds.current, type: "daily", started_at: new Date(now).toISOString() },
  ]);
  if (events.error) throw new Error("Could not create the isolated verification events.");
  const checks = await db.from("checks").insert(Object.entries(checkIds).map(([kind, id]) => ({
    id, event_id: eventIds[kind as keyof typeof eventIds], client_id: kind === "baseline" || kind === "current" ? primaryClientId : auxiliaryClientId,
    status: "calling", ladder_step: 0, last_call_id: callIds[kind as keyof typeof callIds], next_action_at: null,
  })));
  if (checks.error) throw new Error("Could not create the isolated verification checks.");
}

async function verifyEvidence() {
  await webhook(dailyCall(checkIds.baseline, callIds.baseline, 3));
  const baseline = assessment(await readCheck(checkIds.baseline));
  assert.equal(baseline.answers.pain.value, 3);
  assert.equal(baseline.comparison.status, "no_previous_check");
  assert.ok(POSTOP_FIELDS.every((field) => baseline.answers[field].status === "reported"));
  await webhook(dailyCall(checkIds.current, callIds.current, 7));
  const currentCheck = await readCheck(checkIds.current);
  const current = assessment(currentCheck);
  assert.equal(currentCheck.status, "needs_human", "A complete post-op conversation still requires nurse review.");
  assert.equal(current.answers.pain.value, 7);
  assert.equal(current.answers.pain.quote, "My pain is 7 out of 10 right now.");
  assert.equal(current.comparison.previous_call_id, callIds.baseline);
  assert.equal(current.comparison.status, "compared");
  assert.deepEqual(current.comparison.unavailable_fields, []);
  assert.deepEqual(current.changes.map((change) => ({ field: change.field, before: change.previous, now: change.current })), [{ field: "pain", before: 3, now: 7 }]);
  assert.equal(current.changes[0].previous_quote, "My pain is 3 out of 10 right now.");
  assert.equal(current.changes[0].current_quote, "My pain is 7 out of 10 right now.");
  assert.equal(current.suggested_next_step.status, "proposed");
  assertions.push("Two real daily records persist eight source-backed answers, exact patient quotes, and the previous-call pain change from 3 to 7.");

  await webhook(dailyCall(checkIds.auxiliary, callIds.auxiliary, 3, true));
  const partial = assessment(await readCheck(checkIds.auxiliary));
  assert.equal(partial.answers.pain.status, "reported");
  assert.equal(partial.answers.incision.status, "unknown", "A missing answer stays unknown.");
  assert.equal(partial.answers.fever.status, "unknown", "An agent-only or fabricated patient quote cannot establish fever status.");
  assert.equal(partial.answers.fever.quote, null);
  assert.ok(POSTOP_FIELDS.filter((field) => field !== "pain").every((field) => partial.answers[field].value === null));
  assertions.push("Missing answers and a fabricated fever quote appearing only in agent speech remain unknown.");
}

async function verifyApproval() {
  const path = `/api/checks/${checkIds.auxiliary}/postop-review`;
  const input = { call_id: callIds.auxiliary, reviewer: "Verification Nurse" };
  const first = await api<ApiData>(path, input);
  assert.equal(first.applied, true);
  const saved = await readCheck(checkIds.auxiliary);
  const review = assessment(saved).suggested_next_step;
  assert.equal(review.status, "approved");
  assert.equal(review.reviewer, input.reviewer);
  assert.ok(review.approved_at);
  assert.equal(saved.status, "needs_human", "Approval must not resolve or dispatch care.");
  assert.equal(saved.handled_at, null);
  const second = await api<ApiData>(path, { ...input, reviewer: "Different Reviewer" });
  assert.equal(second.duplicate, true);
  assert.deepEqual(assessment(await readCheck(checkIds.auxiliary)).suggested_next_step, review);
  const staleId = `mock_postop_${randomUUID()}`;
  const moved = await supabaseAdmin().from("checks").update({ last_call_id: staleId }).eq("id", checkIds.auxiliary);
  if (moved.error) throw new Error("Could not prepare isolated stale-call verification.");
  assert.equal((await request(path, input)).status, 409);
  assert.equal((await request(path, { ...input, call_id: staleId })).status, 409, "A new call ID cannot approve the previous call's evidence.");
  assert.equal((await webhook(dailyCall(checkIds.auxiliary, callIds.auxiliary, 3))).skipped, "stale_call");
  assertions.push("Nurse approval persists, is idempotent, retains its original reviewer/time, and rejects both stale calls and mismatched evidence.");

  const currentId = await prepareAuxiliaryCall();
  const currentCall = dailyCall(checkIds.auxiliary, currentId, 3);
  await webhook(currentCall);
  await api(`/api/checks/${checkIds.auxiliary}/handled`, {});
  const handled = await readCheck(checkIds.auxiliary);
  assert.equal((await request(path, { call_id: currentId, reviewer: "Verification Nurse" })).status, 409);
  assert.equal((await webhook(currentCall)).skipped, "handled");
  assert.equal((await webhook({ call_id: currentId, metadata: currentCall.metadata }, "transfer_started")).skipped, "handled");
  const after = await readCheck(checkIds.auxiliary);
  assert.equal(after.status, "handled");
  assert.equal(after.handled_at, handled.handled_at);
  assert.deepEqual(after.postop_assessment, handled.postop_assessment);
  assertions.push("Handled checks resist late analysis, late transfer events, and further nurse approval.");

  const concurrentId = await prepareAuxiliaryCall();
  await webhook(dailyCall(checkIds.auxiliary, concurrentId, 3));
  const approvals = await Promise.all(["Concurrent Nurse A", "Concurrent Nurse B"].map((reviewer) => api<ApiData>(path, { call_id: concurrentId, reviewer })));
  assert.equal(approvals.filter((result) => result.applied).length, 1);
  assert.equal(approvals.filter((result) => result.duplicate).length, 1);
  const winningReview = assessment(await readCheck(checkIds.auxiliary)).suggested_next_step;
  assert.ok(["Concurrent Nurse A", "Concurrent Nurse B"].includes(winningReview.reviewer ?? ""));
  for (const result of approvals) {
    assert.ok(result.check);
    assert.deepEqual(assessment(result.check).suggested_next_step, winningReview);
  }
  assertions.push("Concurrent nurse approvals commit one reviewer and return the same persisted decision to both requests.");
}

async function verifyIdentityPlanning() {
  const callId = await prepareAuxiliaryCall();
  const priorDailyAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const prepared = await supabaseAdmin().from("clients").update({ needs_ride: true, last_daily_at: priorDailyAt }).eq("id", auxiliaryClientId);
  if (prepared.error) throw new Error("Could not prepare the isolated identity-planning case.");
  const call = dailyCall(checkIds.auxiliary, callId, 3);
  Object.assign(call.call_analysis!.custom_analysis_data!, { postop_patient_confirmed: false, client_status: "ok", needs_ride: false });
  await webhook(call);
  const state = assessment(await readCheck(checkIds.auxiliary));
  assert.equal(state.patient_confirmed, false);
  assert.ok(POSTOP_FIELDS.every((field) => state.answers[field].status === "unknown"));
  const patient = await supabaseAdmin().from("clients").select("needs_ride,last_daily_at").eq("id", auxiliaryClientId).single();
  if (patient.error || !patient.data) throw new Error("Could not inspect isolated planning fields.");
  assert.equal(patient.data.needs_ride, true);
  assert.equal(Date.parse(patient.data.last_daily_at), Date.parse(priorDailyAt));
  assertions.push("Unconfirmed patient identity cannot clear an existing ride need or claim a completed daily check-in.");
}

async function verifyTransfers() {
  for (const [event, expected] of [["transfer_cancelled", "failed"], ["transfer_ended", "ended_unconfirmed"], ["transfer_bridged", "connected"]] as const) {
    const callId = await prepareAuxiliaryCall();
    const transferCall: RetellCall = { call_id: callId, metadata: { check_id: checkIds.auxiliary, target: "client", mode: "daily" } };
    await webhook(transferCall, "transfer_started");
    assert.equal((await readCheck(checkIds.auxiliary)).nurse_transfer?.status, "started");
    // Provider callbacks may omit metadata; the app must resolve only the active call.
    await webhook({ call_id: callId }, event);
    let state = await readCheck(checkIds.auxiliary);
    assert.equal(state.nurse_transfer?.status, expected);
    assert.equal(state.status, "needs_human");
    assert.equal(state.handled_at, null);
    assert.equal(state.next_action_at, null);
    if (expected !== "connected") assert.match(state.sms_status ?? "", /MOCK MODE/, "Unconfirmed transfers must leave a simulated coordinator notification.");
    await webhook(transferCall, "transfer_started");
    assert.equal((await readCheck(checkIds.auxiliary)).nurse_transfer?.status, expected, "An older started event cannot downgrade the observed transfer state.");
    await webhook(dailyCall(checkIds.auxiliary, callId, 3));
    state = await readCheck(checkIds.auxiliary);
    assert.equal(state.status, "needs_human", "Post-call analysis cannot clear an unresolved transfer.");
    assert.equal(state.nurse_transfer?.status, expected);
    assert.equal(state.handled_at, null, "A human bridge is not medical completion or nurse acceptance.");
    assert.equal(state.next_action_at, null);
    if (expected === "connected") {
      await webhook(transferCall, "transfer_ended");
      assert.equal((await readCheck(checkIds.auxiliary)).nurse_transfer?.status, "connected");
    }
  }
  assertions.push("Failed and unconfirmed transfers remain open after analysis; bridged calls remain open too, with no medical completion or nurse-identity claim.");
  for (const [event, expected] of [["transfer_cancelled", "failed"], ["transfer_bridged", "connected"]] as const) {
    const callId = await prepareAuxiliaryCall();
    const call: RetellCall = { call_id: callId, metadata: { check_id: checkIds.auxiliary, target: "client", mode: "daily" } };
    await webhook(call, event);
    await webhook({ ...call, call_status: "not_connected", disconnection_reason: "dial_no_answer", transcript: "", transcript_object: [], call_analysis: { in_voicemail: true } });
    const state = await readCheck(checkIds.auxiliary);
    assert.equal(state.status, "needs_human");
    assert.equal(state.next_action_at, null);
    assert.equal(state.nurse_transfer?.status, expected);
    assert.equal(state.postop_assessment, null, "No-answer analysis must not invent a post-op conversation.");
  }
  assertions.push("Late no-answer analysis cannot reopen automated dialing after a failed or connected transfer, or invent post-op answers.");
}

async function verifyCrisis() {
  const call = dailyCall(checkIds.crisis, callIds.crisis, 3);
  call.metadata = { check_id: checkIds.crisis, target: "client", mode: "crisis" };
  await webhook(call);
  assert.equal((await readCheck(checkIds.crisis)).postop_assessment, null, "Crisis mode must not acquire daily post-op records even if analysis fields are supplied.");
  await webhook({ call_id: callIds.crisis, metadata: call.metadata }, "transfer_ended");
  const state = await readCheck(checkIds.crisis);
  assert.equal(state.postop_assessment, null);
  assert.equal(state.status, "needs_human");
  assert.equal(state.urgency, "urgent");
  assert.equal(state.nurse_transfer?.status, "ended_unconfirmed");
  assertions.push("Crisis analysis never creates a daily assessment; an unconfirmed crisis transfer remains an urgent human handoff.");

  const contactCallId = `mock_postop_${randomUUID()}`;
  const prepared = await supabaseAdmin().from("checks").update({ status: "calling", urgency: null, flag_reason: null, ladder_step: 3, last_call_id: contactCallId, nurse_transfer: null }).eq("id", checkIds.crisis);
  if (prepared.error) throw new Error("Could not prepare the isolated crisis contact case.");
  const contactCall = dailyCall(checkIds.crisis, contactCallId, 3);
  contactCall.metadata = { check_id: checkIds.crisis, target: "emergency_contact", mode: "crisis" };
  contactCall.call_analysis!.custom_analysis_data!.contact_confirms_ok = true;
  await webhook({ call_id: contactCallId, metadata: contactCall.metadata }, "transfer_bridged");
  await webhook(contactCall);
  const contactState = await readCheck(checkIds.crisis);
  assert.equal(contactState.status, "needs_human");
  assert.equal(contactState.urgency, "urgent");
  assert.equal(contactState.nurse_transfer?.status, "connected");
  assert.equal(contactState.postop_assessment, null);
  assertions.push("A crisis emergency-contact transfer remains an urgent open handoff even after the contact's okay report.");
}

async function prepareRetainedTransfer() {
  const callId = await prepareAuxiliaryCall();
  const call = dailyCall(checkIds.auxiliary, callId, 3, true);
  await webhook({ call_id: callId, metadata: call.metadata }, "transfer_cancelled");
  await webhook(call);
  const moved = await supabaseAdmin().from("checks").update({ event_id: eventIds.current }).eq("id", checkIds.auxiliary).eq("client_id", auxiliaryClientId);
  if (moved.error) throw new Error("Could not retain the isolated transfer demo beside the comparison card.");
}

async function cleanup(keepDemo: boolean) {
  if (!fixturesCreated) return;
  const db = supabaseAdmin();
  const removedEvents = await db.from("events").delete().in("id", keepDemo ? [eventIds.auxiliary, eventIds.crisis] : Object.values(eventIds));
  if (removedEvents.error) throw new Error("Could not clean up this run's isolated verification events.");
  if (!keepDemo) {
    const removedClients = await db.from("clients").delete().in("id", [primaryClientId, auxiliaryClientId]);
    if (removedClients.error) throw new Error("Could not clean up this run's isolated fictional patients.");
  }
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--keep")) throw new Error("Usage: npx tsx scripts/verify-postop.ts [--keep]");
  let databaseUrl: URL;
  try { databaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""); }
  catch { throw new Error("Post-op verification requires a configured local Supabase URL."); }
  if (!local(BASE) || !local(databaseUrl) || databaseUrl.port !== "55321" || process.env.MOCK_RETELL !== "true") {
    throw new Error("Post-op verification requires loopback HTTP, local Supabase on port 55321, and MOCK_RETELL=true. Nothing was changed.");
  }
  const health = await api<{ database: boolean; mockMode: boolean; fictionalData: boolean }>("/api/health");
  assert.ok(health.database && health.mockMode && health.fictionalData, "The running app must have its database connected, mock calls enabled, and fictional data enabled.");
  const schema = await supabaseAdmin().from("checks").select("id,postop_assessment,nurse_transfer").limit(1);
  if (schema.error) throw new Error("Apply the post-op migration before this verifier; no fixtures were created.");
  let passed = false;
  try {
    await createFixtures();
    await verifyEvidence();
    await verifyApproval();
    await verifyIdentityPlanning();
    await verifyTransfers();
    await verifyCrisis();
    if (KEEP) await prepareRetainedTransfer();
    passed = true;
  } finally { await cleanup(passed && KEEP); }
  await mkdir(resolve("output/postop"), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({
    completedAt: new Date().toISOString(), runId, mode: "MOCK MODE", database: "actual local Supabase persistence",
    app: BASE.origin, passed, outboundCallsPlaced: false, outboundTextsSent: false,
    retainedDemo: KEEP ? { eventId: eventIds.current, checkId: checkIds.current, transferCheckId: checkIds.auxiliary, baselineEventId: eventIds.baseline } : null,
    assertions,
  }, null, 2));
  console.log(`Post-op verification passed (${assertions.length} integration scenarios). ${KEEP ? "Fictional comparison and failed-transfer cards retained in the latest daily demo." : "All isolated fixtures cleaned up."}`);
  console.log(`Report: ${OUTPUT}`);
}

void main().catch((error: unknown) => {
  // Avoid echoing provider data or complete database records into verification output.
  console.error(error instanceof Error ? error.message : "Post-op verification failed.");
  process.exitCode = 1;
});
