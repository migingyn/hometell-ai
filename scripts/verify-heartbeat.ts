// Exercises the real HTTP routes and Supabase persistence using explicitly simulated calls.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildFakeWebhook } from "./fake-webhook";
import { SAMPLE_ALERT } from "../lib/mode";
import { supabaseAdmin } from "../lib/supabase";
import type { ApiResult, CheckWithClient, EventMode, HeartbeatEvent, RetellWebhookPayload } from "../lib/types";

const BASE = (process.env.APP_URL ?? "http://localhost:3017").replace(/\/$/, "");
const OUTPUT = resolve("output/heartbeat/verification.json");
type Outcome = Parameters<typeof buildFakeWebhook>[1];
type SavedState = Pick<CheckWithClient, "id" | "status" | "ladder_step" | "urgency" | "sms_status" | "last_call_id" | "next_action_at"> & { label: string };
type ModeReport = { mode: EventMode; eventId: string; assertions: string[]; states: SavedState[]; elapsedSeconds: number };
type StartedEvent = { event: HeartbeatEvent; checkCount: number; failed: number; mockMode: boolean };

async function request(path: string, body?: unknown): Promise<{ status: number; body: ApiResult<unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  let payload: ApiResult<unknown>;
  try { payload = await response.json() as ApiResult<unknown>; }
  catch { throw new Error(`Heartbeat endpoint ${path} returned invalid JSON (HTTP ${response.status}).`); }
  return { status: response.status, body: payload };
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await request(path, body);
  if (response.status >= 400 || !response.body.ok) throw new Error(`Heartbeat endpoint ${path} failed (HTTP ${response.status}). Check the local app logs.`);
  return response.body.data as T;
}

async function readCheck(id: string): Promise<CheckWithClient> {
  const { data, error } = await supabaseAdmin().from("checks").select("*,client:clients(*)").eq("id", id).single();
  if (error || !data) throw new Error("Could not read the verification check from Supabase.");
  return data as unknown as CheckWithClient;
}

function snapshot(label: string, check: CheckWithClient): SavedState {
  // Deliberately omit client records, telephone numbers, transcripts, and provider credentials.
  return { label, id: check.id, status: check.status, ladder_step: check.ladder_step, urgency: check.urgency,
    sms_status: check.sms_status, last_call_id: check.last_call_id, next_action_at: check.next_action_at };
}

async function webhook(payload: RetellWebhookPayload) {
  return api<Record<string, unknown>>("/api/retell/webhook", payload);
}

async function fake(id: string, outcome: Outcome, mode: EventMode, target: "client" | "emergency_contact" = "client") {
  const current = await readCheck(id);
  await webhook(buildFakeWebhook(current, outcome, target, mode));
  return readCheck(id);
}

function assertRealDueTimestamp(check: CheckWithClient) {
  assert.ok(check.next_action_at, "A missed call must have a real persisted next-action timestamp.");
  const remaining = Date.parse(check.next_action_at) - Date.now();
  assert.ok(remaining >= 0 && remaining <= 17_000, "The app must run with DEMO_TIME_SCALE=0.05 (a five-minute step becomes fifteen seconds).");
}

async function startMode(mode: EventMode): Promise<StartedEvent> {
  const requestId = randomUUID();
  const input = { type: mode, request_id: requestId, ...(mode === "crisis" ? { alert_text: SAMPLE_ALERT } : {}) };
  const started = await api<StartedEvent>("/api/events/start", input);
  const repeated = await api<{ event: HeartbeatEvent; duplicate: boolean }>("/api/events/start", input);
  assert.equal(repeated.duplicate, true, "The same start request ID must not dispatch a second roster.");
  assert.equal(repeated.event.id, started.event.id);
  const count = await supabaseAdmin().from("events").select("id", { count: "exact", head: true }).eq("request_id", requestId);
  if (count.error) throw new Error("Could not verify start-request idempotency.");
  assert.equal(count.count, 1);
  return started;
}

async function verifyPrivacy() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Anonymous database privacy verification requires the configured public Supabase URL and anon key.");
  const anonymous = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const privateRoster = await anonymous.from("clients").select("*");
  if (privateRoster.error) throw new Error("The anonymous private-roster read failed before its row-level policy could be verified.");
  assert.deepEqual(privateRoster.data, [], "Anonymous clients reads must return no private roster rows.");
  const publicRoster = await anonymous.from("clients_public").select("*");
  if (publicRoster.error) throw new Error("The public dashboard roster view could not be read anonymously.");
  assert.ok((publicRoster.data?.length ?? 0) >= 7, "The safe dashboard view must retain the fictional roster.");
  assert.ok(publicRoster.data!.every((row) => Object.keys(row).every((name) => !/phone|telephone|mobile/i.test(name))), "The public roster must have no telephone number columns.");
}

async function verifyDailyPlanning(): Promise<{ eventId: string; assertions: string[] }> {
  const db = supabaseAdmin();
  const { data: harold, error } = await db.from("clients").select("id,needs_ride,last_daily_at").eq("name", "Harold Kim").single();
  if (error || !harold) throw new Error("The focused daily-planning regression needs fictional Harold Kim in the roster.");
  // Keep the live rehearsal prepared for the next crisis ride-priority check.
  const prepared = await db.from("clients").update({ needs_ride: true }).eq("id", harold.id);
  if (prepared.error) throw new Error("Could not prepare the fictional client's existing ride need.");
  const started = await startMode("daily");
  assert.equal(started.mockMode, true);
  const { data: selected, error: checkError } = await db.from("checks").select("*,client:clients(*)")
    .eq("event_id", started.event.id).eq("client_id", harold.id).single();
  if (checkError || !selected) throw new Error("Could not select Harold's new daily check.");
  const check = selected as unknown as CheckWithClient;
  const readPlanning = async () => {
    const row = await db.from("clients").select("needs_ride,last_daily_at").eq("id", harold.id).single();
    if (row.error || !row.data) throw new Error("Could not read persisted daily planning fields.");
    return row.data;
  };
  const before = await readPlanning();
  const unclear = buildFakeWebhook(check, "unclear", "client", "daily");
  unclear.call.call_analysis!.custom_analysis_data!.needs_ride = false;
  await webhook(unclear);
  const preserved = await readPlanning();
  assert.equal(preserved.needs_ride, true, "An unclear or third-party answer cannot clear an existing ride need.");
  assert.equal(preserved.last_daily_at, before.last_daily_at, "An unclear call is not a completed personal daily check-in.");

  const confirmed = async (needsRide: boolean) => {
    // A new explicitly simulated attempt allows the real duplicate/stale guards
    // to remain active without making a second complete roster call.
    const callId = `mock_${randomUUID()}`;
    const queued = await db.from("checks").update({ status: "calling", last_call_id: callId, handled_at: null })
      .eq("id", check.id);
    if (queued.error) throw new Error("Could not prepare the next explicit mock daily answer.");
    const current = await readCheck(check.id);
    const payload = buildFakeWebhook(current, needsRide ? "needs_ride" : "ok", "client", "daily");
    assert.equal(payload.call.call_analysis?.custom_analysis_data?.postop_patient_confirmed, true);
    assert.ok(payload.call.call_analysis?.custom_analysis_data?.postop_identity_quote);
    assert.ok(payload.call.call_analysis?.custom_analysis_data?.needs_ride_quote);
    await webhook(payload);
    const after = await readPlanning();
    assert.equal(after.needs_ride, needsRide, "A confirmed client mobility answer must persist its explicit boolean.");
    assert.ok(after.last_daily_at);
  };
  await confirmed(false);
  await confirmed(true);
  const assertions = ["unclear client_status with missing ride quote preserves existing true and last_daily_at", "identified patient's exact independent-mobility quote persists false", "identified patient's exact ride-need quote persists true", "Harold ends with needs_ride=true for crisis ride-priority verification"];
  await mkdir(resolve("output/heartbeat"), { recursive: true });
  await writeFile(resolve("output/heartbeat/daily-planning-verification.json"), JSON.stringify({
    completedAt: new Date().toISOString(), eventId: started.event.id, mode: "MOCK MODE", database: "actual Supabase persistence",
    outboundCallsPlaced: false, outboundTextsSent: false, assertions,
  }, null, 2));
  console.log("Daily planning: unclear false preserved the existing ride need; confirmed false and true persisted. Harold remains needs_ride=true.");
  return { eventId: started.event.id, assertions };
}

async function verifyMode(mode: EventMode, started: StartedEvent): Promise<ModeReport> {
  const began = Date.now();
  assert.equal(started.mockMode, true, "Verification must never place live calls.");
  assert.equal(started.failed, 0, "All simulated initial calls must be recorded.");
  const { data, error } = await supabaseAdmin().from("checks").select("*,client:clients(*)").eq("event_id", started.event.id).order("id");
  if (error || !data || data.length < 7) throw new Error("Verification requires at least seven seeded fictional client identities.");
  const checks = data as unknown as CheckWithClient[];
  assert.ok(checks.every((check) => check.status === "calling" && check.last_call_id?.startsWith("mock_")));
  const [okay, danger, ordinary, contact, unreachable, handled, abandoned] = checks;
  const report: ModeReport = { mode, eventId: started.event.id, assertions: ["identical start request ID returns the same single event without redispatch"], states: [], elapsedSeconds: 0 };

  const okayPayload = buildFakeWebhook(okay, "ok", "client", mode);
  await webhook(okayPayload);
  const okayState = await readCheck(okay.id);
  assert.equal(okayState.status, mode === "daily" ? "needs_human" : "ok");
  if (mode === "daily") {
    assert.equal(okayState.urgency, "follow_up");
    assert.equal(okayState.postop_assessment?.patient_confirmed, true);
    assert.equal(okayState.postop_assessment?.suggested_next_step.status, "proposed");
    assert.ok(Object.values(okayState.postop_assessment!.answers).every((answer) => answer.status === "reported"));
    assert.equal(okayState.sms_status, null, "A complete post-op record awaits nurse review without an urgent text.");
  }
  assert.equal(okayState.next_action_at, null);
  const duplicate = await webhook(okayPayload);
  assert.equal(duplicate.duplicate, true, "A repeated analyzed call ID must be ignored.");
  const logCount = await supabaseAdmin().from("call_logs").select("id", { count: "exact", head: true }).eq("retell_call_id", okay.last_call_id!);
  if (logCount.error) throw new Error("Could not verify call-log idempotency.");
  assert.equal(logCount.count, 1);
  report.assertions.push(mode === "daily" ? "complete post-op record persisted and awaits nurse review" : "client okay persisted", "duplicate call ID ignored and logged once");
  report.states.push(snapshot("okay", okayState));

  const dangerState = await fake(danger.id, "needs_human", mode);
  assert.equal(dangerState.status, "needs_human");
  assert.equal(dangerState.urgency, "urgent");
  assert.equal(dangerState.flag_reason, 'said "dizzy"');
  assert.match(dangerState.sms_status ?? "", /MOCK MODE/);
  report.assertions.push("user danger words create urgent human handoff with simulated coordinator text");
  report.states.push(snapshot("danger", dangerState));

  const ordinaryState = await fake(ordinary.id, "follow_up", mode);
  assert.equal(ordinaryState.status, "needs_human");
  assert.equal(ordinaryState.urgency, mode === "daily" ? "follow_up" : "urgent");
  if (mode === "daily") assert.equal(ordinaryState.sms_status, null, "An ordinary daily request must not text the coordinator.");
  else assert.match(ordinaryState.sms_status ?? "", /MOCK MODE/);
  report.assertions.push(mode === "daily" ? "ordinary request is amber follow-up without coordinator SMS" : "crisis help request is urgent with simulated coordinator SMS");
  report.states.push(snapshot("ordinary-request", ordinaryState));

  await api(`/api/checks/${handled.id}/handled`, {});
  const handledResult = await webhook(buildFakeWebhook(handled, "needs_human", "client", mode));
  assert.equal(handledResult.skipped, "handled");
  const handledState = await readCheck(handled.id);
  assert.equal(handledState.status, "handled");
  assert.equal(handledState.next_action_at, null);
  report.assertions.push("mark handled survives late danger webhook");
  report.states.push(snapshot("handled", handledState));

  // Reproduce a worker disappearing after claiming an action. The update trigger
  // refreshes updated_at, so the old age belongs specifically to action_started_at.
  const abandonedCall = abandoned.last_call_id;
  const claimed = await supabaseAdmin().from("checks").update({
    status: "no_answer", action_token: randomUUID(), action_started_at: new Date(Date.now() - 4 * 60_000).toISOString(), next_action_at: null,
  }).eq("id", abandoned.id);
  if (claimed.error) throw new Error("Could not prepare the simulated abandoned action claim.");
  await api("/api/ladder/tick", {});
  let recovered = await readCheck(abandoned.id);
  const recoveryDeadline = Date.now() + 3_000;
  while (!/MOCK MODE/.test(recovered.sms_status ?? "") && Date.now() < recoveryDeadline) {
    await new Promise((done) => setTimeout(done, 100));
    recovered = await readCheck(abandoned.id);
  }
  assert.equal(recovered.status, "needs_human");
  assert.equal(recovered.urgency, "urgent");
  assert.match(recovered.flag_reason ?? "", /outcome unknown/i);
  assert.match(recovered.sms_status ?? "", /MOCK MODE/);
  assert.equal(recovered.last_call_id, abandonedCall, "An uncertain abandoned claim must never redial automatically.");
  assert.equal(recovered.ladder_step, 0);
  assert.equal(recovered.next_action_at, null);
  const claimState = await supabaseAdmin().from("checks").select("action_token,action_started_at").eq("id", abandoned.id).single();
  if (claimState.error) throw new Error("Could not inspect the recovered abandoned claim.");
  assert.equal(claimState.data.action_token, null);
  assert.equal(claimState.data.action_started_at, null);
  report.assertions.push("old action_started_at claim becomes urgent with simulated coordinator text and no redial");
  report.states.push(snapshot("abandoned-claim-human-handoff", recovered));

  // Start both unanswered paths together. Only the contact case's first step is
  // advanced manually to test the claim race; every remaining step waits until due.
  const contactMiss = await fake(contact.id, "no_answer", mode);
  assertRealDueTimestamp(contactMiss);
  const oldContactCall = contactMiss.last_call_id;
  const concurrent = await Promise.all([
    request(`/api/ladder/advance/${contact.id}`, {}), request(`/api/ladder/advance/${contact.id}`, {}),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 200 && result.body.ok).length, 1, "Only one concurrent advance may claim the retry.");
  assert.equal(concurrent.filter((result) => result.status === 409).length, 1);
  let contactState = await readCheck(contact.id);
  assert.equal(contactState.status, "calling");
  assert.equal(contactState.ladder_step, 1);
  assert.notEqual(contactState.last_call_id, oldContactCall);
  const stale = buildFakeWebhook(contactMiss, "ok", "client", mode);
  assert.equal((await webhook(stale)).skipped, "stale_call");
  assert.equal((await readCheck(contact.id)).status, "calling");
  report.assertions.push("concurrent advances accept exactly one retry", "stale retry result cannot change the current call");
  report.states.push(snapshot("contact-retry", contactState));
  contactState = await fake(contact.id, "no_answer", mode);
  assertRealDueTimestamp(contactState);
  const unreachableState = await fake(unreachable.id, "no_answer", mode);
  assertRealDueTimestamp(unreachableState);
  report.states.push(snapshot("unanswered", unreachableState));

  const deadline = Date.now() + 95_000;
  let contactDone = false;
  let unreachableDone = false;
  const recorded = new Set<string>();
  while (!contactDone || !unreachableDone) {
    assert.ok(Date.now() < deadline, `The ${mode} ladder did not complete within its bounded verification window.`);
    await api("/api/ladder/tick", {});
    for (const [id, kind] of [[contact.id, "contact"], [unreachable.id, "unreachable"]] as const) {
      let current = await readCheck(id);
      const marker = `${kind}-${current.ladder_step}-${current.status}`;
      if (!recorded.has(marker)) { report.states.push(snapshot(marker, current)); recorded.add(marker); }
      if (current.status === "calling" && current.ladder_step === 1) {
        current = await fake(id, "no_answer", mode);
      } else if (current.status === "calling" && current.ladder_step === 3) {
        current = await fake(id, kind === "contact" ? "ok" : "no_answer", mode, "emergency_contact");
      }
      if (kind === "contact" && current.status === "ok") {
        assert.equal(current.ladder_step, 3);
        assert.equal(current.next_action_at, null);
        assert.match(current.summary ?? "", /^Confirmed okay by /);
        if (!contactDone) report.states.push(snapshot("contact-confirmed-okay", current));
        contactDone = true;
      }
      if (kind === "unreachable" && current.status === "needs_human") {
        assert.equal(current.ladder_step, 4);
        assert.equal(current.flag_reason, "unreachable");
        assert.equal(current.urgency, "urgent");
        assert.equal(current.next_action_at, null);
        assert.match(current.sms_status ?? "", /MOCK MODE/);
        if (!unreachableDone) report.states.push(snapshot("unreachable-human-handoff", current));
        unreachableDone = true;
      }
    }
    if (!contactDone || !unreachableDone) await new Promise((done) => setTimeout(done, 750));
  }
  report.assertions.push("persisted due timestamps drive retry → text → emergency contact → unreachable handoff", "emergency contact confirmation ends the ladder", "terminal unreachable sends a simulated coordinator text in both modes");
  report.elapsedSeconds = Math.round((Date.now() - began) / 100) / 10;
  console.log(`${mode}: verified persisted states, idempotency, concurrency, and the complete no-answer ladder.`);
  return report;
}

async function main() {
  if (process.env.MOCK_RETELL !== "true") throw new Error("Verification requires MOCK_RETELL=true. No database changes were requested.");
  if (Number(process.env.DEMO_TIME_SCALE) !== 0.05) throw new Error("Verification requires DEMO_TIME_SCALE=0.05 in both the script and local app.");
  const health = await api<{ database: boolean; mockMode: boolean; fictionalData: boolean }>("/api/health");
  assert.equal(health.mockMode, true, "The app must explicitly report mock calling before verification may mutate it.");
  assert.equal(health.database, true, "The app must connect to the actual rehearsal Supabase database.");
  assert.equal(health.fictionalData, true, "Verification is only for the labeled fictional rehearsal roster.");
  const roster = await supabaseAdmin().from("clients").select("id", { count: "exact", head: true });
  if (roster.error || (roster.count ?? 0) < 7) throw new Error("Seed at least seven fictional clients before verification. No event was started.");
  await verifyPrivacy();
  if (process.argv.includes("--daily-planning-only")) { await verifyDailyPlanning(); return; }
  const startedAt = new Date().toISOString();
  // Initial batch dispatch is serialized; separate event IDs then allow the two
  // persisted no-answer ladders to run concurrently without overlapping dispatch.
  const daily = await startMode("daily");
  const crisis = await startMode("crisis");
  const modes = await Promise.all([verifyMode("daily", daily), verifyMode("crisis", crisis)]);
  await mkdir(resolve("output/heartbeat"), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({ startedAt, completedAt: new Date().toISOString(), mode: "MOCK MODE", simulatedCalls: true,
    assertions: ["anonymous clients SELECT returns no rows", "anonymous clients_public roster contains no phone columns"],
    database: "actual Supabase persistence", outboundCallsPlaced: false, outboundTextsSent: false, modes }, null, 2));
  console.log("Heartbeat verification passed in both modes. Evidence saved to output/heartbeat/verification.json (no client records, phones, or secrets).");
}

if (/verify-heartbeat\.(?:ts|js)$/.test(process.argv[1] ?? "")) void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Heartbeat verification failed.");
  process.exitCode = 1;
});
