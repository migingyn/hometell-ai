// Local integration verification. Provider callbacks, lookup responses, and recording
// transport are fixtures; one waveform goes through the actual local acoustic model.
// This deliberately does not place a call or measure emotion-classification accuracy.
import "./env";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { interceptRehearsalWebhook, publicRehearsal, readRehearsal } from "../lib/demo/rehearsal";
import { processRehearsalAcoustics } from "../lib/demo/rehearsal-acoustic";
import { sortChecksForDashboard } from "../lib/priority-ordering";
import { supabaseAdmin } from "../lib/supabase";
import type { AcousticAnalysis, SpeakerSegment } from "../lib/acoustic/types";
import type { CheckWithClient, RetellCall } from "../lib/types";

type FixtureCall = RetellCall & {
  agent_id: string; recording_url?: string;
  metadata: NonNullable<RetellCall["metadata"]> & { rehearsal_request_id: string };
};
type Fixture = { sessionId: string; requestId: string; eventId: string; checkId: string; clientId: string; call: FixtureCall };
const fixtures: Fixture[] = [];
const scheduled: string[] = [];
const assertions: string[] = [];
const observations: Record<string, unknown>[] = [];
const providerCalls = new Map<string, FixtureCall>();
const recordingBytes = new Map<string, Uint8Array>();
const agentId = "rehearsal_acoustic_verification_fixture";
const root = "services/acoustic-analysis/fixtures-local";
const counters = { providerLookups: 0, recordingDownloads: 0, realModelRequests: 0, syntheticModelResponses: 0, failedModelRequests: 0, outboundCallsPlaced: 0 };
let modelMode: "real" | "synthetic" | "outage" = "real";
let duringDownload: (() => Promise<void>) | null = null;

function loopback(value: string, description: string) {
  const url = new URL(value);
  assert.ok(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), `${description} must be local HTTP`);
  return url;
}
function elevatedFixture(): AcousticAnalysis {
  return { version: "1", status: "available", signal: "elevated",
    model: { id: "fixture/synthetic-acoustic-response", revision: "integration-only", labels: ["fearful", "neutral"] },
    scores: { fearful: 0.9, neutral: 0.1 },
    quality: { duration_seconds: 13.513, speech_seconds: 3, clipping_fraction: 0, sample_rate: 16000,
      channels: 2, caller_channel: 1, channel_attribution: "transcript_energy", window_count: 1 },
    segments: [{ start_seconds: 0, end_seconds: 6, signal: "elevated", scores: { fearful: 0.9, neutral: 0.1 } }],
    warnings: ["Synthetic model response for lifecycle and priority verification; not model accuracy evidence."] };
}
function silentWav() {
  const sampleRate = 16000, channels = 2, dataBytes = sampleRate * channels * 2 * 8;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + dataBytes, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}
function signedPayload(event: string, call: FixtureCall) {
  const raw = JSON.stringify({ event, call }), stamp = Date.now();
  const signature = `v=${stamp},d=${createHmac("sha256", process.env.RETELL_API_KEY!).update(raw + stamp).digest("hex")}`;
  return { raw, signature };
}
async function callback(event: string, call: FixtureCall) {
  const { raw, signature } = signedPayload(event, call);
  assert.equal(await interceptRehearsalWebhook(raw, signature, (id) => { scheduled.push(id); }), true);
}
async function requireRow(fixture: Fixture) {
  const row = await readRehearsal(fixture.checkId);
  assert.ok(row);
  return row;
}
async function readCheck(fixture: Fixture): Promise<CheckWithClient> {
  const { data, error } = await supabaseAdmin().from("checks").select("*,client:clients(*)").eq("id", fixture.checkId).single();
  if (error) throw new Error(error.message);
  return data as CheckWithClient;
}
async function createFixture(label: string, text: string, segments: SpeakerSegment[], bytes?: Uint8Array): Promise<Fixture> {
  const fixture: Fixture = { sessionId: randomUUID(), requestId: randomUUID(), eventId: randomUUID(),
    checkId: randomUUID(), clientId: randomUUID(), call: {} as FixtureCall };
  fixtures.push(fixture); // Cleanup also covers partially created fixtures.
  const callId = `call_acoustic_fixture_${fixture.requestId}`;
  const recordingUrl = `https://retellai.s3.us-west-2.amazonaws.com/fixture-only/${fixture.requestId}.wav`;
  fixture.call = { call_id: callId, agent_id: agentId, call_status: "ended", disconnection_reason: "user_hangup",
    metadata: { rehearsal_request_id: fixture.requestId, check_id: fixture.checkId, target: "client", mode: "crisis" },
    transcript_object: segments.map((segment) => ({ role: segment.role,
      content: segment.role === "user" ? text : "Fictional recorded practice check-in; describe what you need.",
      words: [{ start: segment.start, end: segment.end, word: "fixture-timing" }] })),
    call_analysis: { call_summary: `SYNTHETIC PROVIDER CALLBACK: ${label}.`, user_sentiment: "Neutral",
      custom_analysis_data: { client_status: "needs_human", summary: text } },
    ...(bytes ? { recording_multi_channel_url: recordingUrl } : {}) };
  providerCalls.set(callId, structuredClone(fixture.call));
  if (bytes) recordingBytes.set(recordingUrl, bytes);
  const db = supabaseAdmin();
  for (const result of [
    await db.from("clients").insert({ id: fixture.clientId, name: `Fictional acoustic test · ${label}`, phone: "+12025550199",
      emergency_contact_name: "Fictional test contact", emergency_contact_phone: "+12025550198", risk_tier: "green",
      lives_alone: false, uses_powered_equipment: false, language: "en" }),
    await db.from("events").insert({ id: fixture.eventId, type: "crisis", request_id: fixture.sessionId, dispatching: false,
      alert_text: `SIMULATED DISASTER REPLAY [${fixture.sessionId}] · acoustic integration fixture only` }),
    await db.from("checks").insert({ id: fixture.checkId, event_id: fixture.eventId, client_id: fixture.clientId }),
    await db.from("call_logs").insert({ check_id: fixture.checkId, retell_call_id: `mock_fixture_complete_${fixture.sessionId}`,
      target: "client", outcome: "disaster_demo_step_complete", raw: { sessionId: fixture.sessionId, step: 5, simulated: true } }),
    await db.rpc("reserve_heartbeat_rehearsal", { p_request_id: fixture.requestId, p_session_id: fixture.sessionId,
      p_event_id: fixture.eventId, p_check_id: fixture.checkId, p_agent_id: agentId }),
    await db.rpc("bind_heartbeat_rehearsal", { p_request_id: fixture.requestId, p_call_id: callId, p_uncertain: false }),
  ]) if (result.error) throw new Error(result.error.message);
  return fixture;
}
async function retryNow(fixture: Fixture) {
  const { error } = await supabaseAdmin().from("heartbeat_rehearsals")
    .update({ acoustic_retry_at: new Date(Date.now() - 1000).toISOString() }).eq("request_id", fixture.requestId);
  if (error) throw new Error(error.message);
}
async function main() {
  assert.equal(process.env.MOCK_RETELL, "true", "Keep the fictional roster in mock mode.");
  assert.ok(process.env.RETELL_API_KEY, "A signature key is required; it is never printed or transmitted.");
  const database = loopback(process.env.NEXT_PUBLIC_SUPABASE_URL!, "Supabase");
  assert.equal(database.port, "55321", "Use only this project's local database.");
  const service = loopback(process.env.ACOUSTIC_SERVICE_URL!, "Acoustic service");
  // A calibrated caller channel would bypass the attribution behavior this checks.
  delete process.env.RETELL_CALLER_AUDIO_CHANNEL; // This process only; no environment files change.
  const source = JSON.parse(await readFile(`${root}/verification.json`, "utf8")) as {
    constructed_stereo: { speaker_segments: SpeakerSegment[] }; results: { source: string; source_sha256: string }[];
  };
  const stereo = new Uint8Array(await readFile(`${root}/constructed-stereo.wav`));
  const segments = source.constructed_stereo.speaker_segments;
  const realFetch = globalThis.fetch;
  const db = supabaseAdmin();
  const before = await db.from("checks").select("id,updated_at");
  if (before.error) throw new Error(before.error.message);
  let success = false, failure: string | undefined;
  const cleanupErrors: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.retellai.com") {
      assert.equal(init?.method ?? "GET", "GET", "A verification run must never place a call.");
      assert.ok(url.pathname.startsWith("/v2/get-call/"));
      assert.ok(new Headers(init?.headers).get("Authorization") === `Bearer ${process.env.RETELL_API_KEY!.trim()}`,
        "Recording lookup must authenticate to the provider.");
      const call = providerCalls.get(decodeURIComponent(url.pathname.slice("/v2/get-call/".length)));
      assert.ok(call, "Only fixture calls may be looked up.");
      counters.providerLookups++;
      return Response.json(call);
    }
    if (url.hostname === "retellai.s3.us-west-2.amazonaws.com") {
      const bytes = recordingBytes.get(url.href);
      assert.ok(bytes, "Only fixture recording URLs may be fetched.");
      assert.equal(init?.redirect, "error");
      counters.recordingDownloads++;
      const hook = duringDownload; duringDownload = null;
      if (hook) await hook();
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "audio/wav" } });
    }
    if (url.origin === service.origin && url.pathname === "/analyze") {
      assert.ok(init?.body instanceof FormData);
      assert.ok(init.body.get("speaker_segments"), "Speaker timing must reach waveform analysis.");
      assert.equal(init.body.has("transcript"), false, "Transcript text is not sent to the model.");
      if (modelMode === "outage") { counters.failedModelRequests++; throw new Error("Synthetic local model outage"); }
      if (modelMode === "synthetic") { counters.syntheticModelResponses++; return Response.json(elevatedFixture()); }
      counters.realModelRequests++;
      return realFetch(input, init);
    }
    assert.ok([database.origin, service.origin].includes(url.origin), "All nonlocal, nonfixture traffic is blocked.");
    return realFetch(input, init);
  };
  try {
    const health = await fetch(new URL("/health", service)).then((response) => response.json());
    assert.equal(health.model_loaded, true, "Start the already configured local acoustic service first.");
    const primary = await createFixture("real local inference", "I am calm, but I am bleeding out.", segments, stereo);
    const unsigned = signedPayload("call_analyzed", primary.call);
    await assert.rejects(interceptRehearsalWebhook(unsigned.raw, null, (id) => { scheduled.push(id); }));
    const wrongAgent = signedPayload("call_analyzed", { ...primary.call, agent_id: "wrong_fixture_agent" });
    await assert.rejects(interceptRehearsalWebhook(wrongAgent.raw, wrongAgent.signature, (id) => { scheduled.push(id); }));
    assert.equal(scheduled.length, 0);
    await callback("transcript_updated", primary.call);
    await callback("call_ended", primary.call);
    assert.equal(scheduled.length, 0, "Only final analysis can schedule recording inference.");
    await callback("call_analyzed", primary.call);
    assert.deepEqual(scheduled, [primary.checkId]);
    await Promise.all([processRehearsalAcoustics(primary.checkId), processRehearsalAcoustics(primary.checkId)]);
    const primaryCheck = await readCheck(primary), primaryRow = await requireRow(primary);
    assert.equal(counters.providerLookups, 1, "Concurrent jobs claim exactly once.");
    assert.equal(counters.realModelRequests, 1);
    assert.equal(primaryRow.acoustic_status, "available");
    assert.equal(primaryCheck.acoustic_assessment?.call_id, primary.call.call_id);
    assert.equal(primaryCheck.acoustic_assessment?.result.status, "available");
    assert.equal(primaryCheck.acoustic_assessment?.result.quality.caller_channel, 1);
    assert.equal(primaryCheck.acoustic_assessment?.result.quality.channel_attribution, "transcript_energy");
    assert.equal(primaryCheck.priority_assessment?.priority, "immediate");
    assert.equal(primaryCheck.priority_assessment?.situation, "immediate_danger");
    assert.equal(primaryCheck.priority_assessment?.distress, "unknown");
    assert.equal(primaryCheck.next_action_at, null);
    assert.equal(primaryCheck.sms_status, null);
    const safe = publicRehearsal(primaryRow)!;
    assert.equal(safe.voiceAnalysis.status, "available");
    assert.equal("raw" in safe, false);
    assert.equal(JSON.stringify(safe).includes("retellai.s3"), false);
    await callback("call_analyzed", primary.call);
    await processRehearsalAcoustics(primary.checkId);
    assert.equal(counters.providerLookups, 1, "Repeated final callback must not reanalyze successful audio.");
    assert.deepEqual((await readCheck(primary)).acoustic_assessment, primaryCheck.acoustic_assessment);
    observations.push({ scenario: "Constructed public actor recording through actual local model", model: primaryCheck.acoustic_assessment?.result.model,
      signal: primaryCheck.acoustic_assessment?.result.signal, quality: primaryCheck.acoustic_assessment?.result.quality,
      sourceRecordings: source.results.map(({ source: url, source_sha256 }) => ({ url, sha256: source_sha256 })) });
    assertions.push("Signed bound callback → one authenticated fixture lookup → caller-only local model inference → persistent result and public status; duplicate jobs and callbacks are idempotent.");
    assertions.push("Transcript severity, quoted distress, and recorded-voice output remain separate; a calm statement accompanying bleeding retains immediate priority and causes no call, text, or automated dispatch.");

    modelMode = "synthetic";
    const late = await createFixture("late recording", "I need a ride to leave.", segments);
    await callback("call_analyzed", late.call);
    const beforeLate = counters.providerLookups;
    await processRehearsalAcoustics(late.checkId);
    let lateRow = await requireRow(late);
    assert.equal(lateRow.acoustic_status, "waiting_for_recording");
    assert.equal(lateRow.acoustic_attempts, 1);
    assert.ok(lateRow.acoustic_retry_at);
    await processRehearsalAcoustics(late.checkId);
    assert.equal(counters.providerLookups, beforeLate + 1, "Polling respects the retry delay.");
    const lateUrl = `https://retellai.s3.us-west-2.amazonaws.com/fixture-only/${late.requestId}.wav`;
    providerCalls.set(late.call.call_id, { ...late.call, recording_multi_channel_url: lateUrl });
    recordingBytes.set(lateUrl, stereo);
    await retryNow(late);
    await processRehearsalAcoustics(late.checkId);
    lateRow = await requireRow(late);
    assert.equal(lateRow.acoustic_status, "available");
    assert.equal(lateRow.acoustic_attempts, 2);
    const lateCheck = await readCheck(late);
    assert.equal(lateCheck.priority_assessment?.situation, "needs_assistance");
    assert.equal(lateCheck.priority_assessment?.distress, "unknown");
    assert.equal(sortChecksForDashboard([lateCheck, primaryCheck], "crisis")[0].id, primary.checkId);
    const sameSeverityWithoutAudio: CheckWithClient = { ...lateCheck, id: randomUUID(), acoustic_assessment: null,
      client: { ...lateCheck.client, name: "A fictional patient without audio" },
      priority_assessment: { ...lateCheck.priority_assessment!, audible_distress: "unavailable" } };
    assert.equal(sortChecksForDashboard([sameSeverityWithoutAudio, lateCheck], "crisis")[0].id, late.checkId);
    assertions.push("A late separate-speaker recording is retried after backoff and recovers; elevated audio never moves a lower-severity patient ahead of immediate reported danger.");

    const signedLate = await createFixture("late signed link fallback", "I need a ride to leave.", segments);
    await callback("call_analyzed", signedLate.call);
    await processRehearsalAcoustics(signedLate.checkId);
    const signedLateUrl = `https://retellai.s3.us-west-2.amazonaws.com/fixture-only/${signedLate.requestId}.wav`;
    recordingBytes.set(signedLateUrl, stereo);
    // Lookup intentionally still omits audio; only a later verified callback has it.
    await callback("call_analyzed", { ...signedLate.call, recording_multi_channel_url: signedLateUrl });
    await retryNow(signedLate); await processRehearsalAcoustics(signedLate.checkId);
    assert.equal((await requireRow(signedLate)).acoustic_status, "available");
    assertions.push("A late signed recording link survives finalized-callback deduplication and works only after an authenticated matching provider lookup.");

    modelMode = "real";
    const silent = await createFixture("unusable silent audio", "I need a ride to leave.", segments, silentWav());
    await callback("call_analyzed", silent.call);
    const silentBefore = (await readCheck(silent)).priority_assessment;
    await processRehearsalAcoustics(silent.checkId);
    const silentCheck = await readCheck(silent);
    assert.equal((await requireRow(silent)).acoustic_status, "insufficient_audio");
    assert.equal(silentCheck.acoustic_assessment?.result.signal, "uncertain");
    assert.deepEqual(silentCheck.acoustic_assessment?.result.scores, {});
    assert.deepEqual(silentCheck.priority_assessment, silentBefore);
    assertions.push("Actual local waveform quality checks reject silent/unattributable audio without emotion scores or a reassuring label.");

    modelMode = "outage";
    const outage = await createFixture("model unavailable", "I am calm, but I am bleeding out.", segments, stereo);
    await callback("call_analyzed", outage.call);
    for (let attempt = 0; attempt < 3; attempt++) { await retryNow(outage); await processRehearsalAcoustics(outage.checkId); }
    const outageRow = await requireRow(outage), outageCheck = await readCheck(outage);
    assert.equal(outageRow.acoustic_status, "unavailable");
    assert.equal(outageRow.acoustic_attempts, 3);
    assert.equal(outageCheck.acoustic_assessment?.result.signal, "uncertain");
    assert.equal(outageCheck.priority_assessment?.priority, "immediate");
    const exhaustedLookups = counters.providerLookups;
    await retryNow(outage); await processRehearsalAcoustics(outage.checkId);
    assert.equal(counters.providerLookups, exhaustedLookups);
    assertions.push("Unavailable model retries are bounded to three, become an explicit unavailable state, and preserve urgent transcript evidence.");

    modelMode = "synthetic";
    const mismatch = await createFixture("provider binding mismatch", "I need a ride to leave.", segments, stereo);
    await callback("call_analyzed", mismatch.call);
    providerCalls.set(mismatch.call.call_id, { ...mismatch.call, metadata: { ...mismatch.call.metadata, check_id: randomUUID() } });
    const downloadsBeforeMismatch = counters.recordingDownloads;
    await processRehearsalAcoustics(mismatch.checkId);
    assert.equal(counters.recordingDownloads, downloadsBeforeMismatch);
    assert.notEqual((await requireRow(mismatch)).acoustic_status, "available");
    const mixed = await createFixture("mixed-only recording", "I need a ride to leave.", segments);
    mixed.call.recording_url = `https://retellai.s3.us-west-2.amazonaws.com/fixture-only/${mixed.requestId}.wav`;
    providerCalls.set(mixed.call.call_id, { ...mixed.call });
    recordingBytes.set(mixed.call.recording_url, stereo);
    await callback("call_analyzed", mixed.call);
    await processRehearsalAcoustics(mixed.checkId);
    assert.equal(counters.recordingDownloads, downloadsBeforeMismatch);
    assert.notEqual((await requireRow(mixed)).acoustic_status, "available");
    assertions.push("Provider responses with a different bound case and mixed-only recordings cannot enter caller-voice inference, even if a prior callback had a recording link.");

    for (const state of ["stale", "handled"] as const) {
      const protectedCase = await createFixture(`${state} case`, "I need a ride to leave.", segments, stereo);
      await callback("call_analyzed", protectedCase.call);
      const patch = state === "stale" ? { last_call_id: `call_newer_fixture_${randomUUID()}` } : { status: "handled", handled_at: new Date().toISOString() };
      const change = await db.from("checks").update(patch).eq("id", protectedCase.checkId);
      if (change.error) throw new Error(change.error.message);
      const beforeProtected = await readCheck(protectedCase);
      const lookups: number = counters.providerLookups;
      await processRehearsalAcoustics(protectedCase.checkId);
      assert.equal(counters.providerLookups, lookups);
      assert.deepEqual(await readCheck(protectedCase), beforeProtected);
    }
    const racing = await createFixture("handled during inference", "I need a ride to leave.", segments, stereo);
    await callback("call_analyzed", racing.call);
    duringDownload = async () => {
      const changed = await db.from("checks").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", racing.checkId);
      if (changed.error) throw new Error(changed.error.message);
    };
    await processRehearsalAcoustics(racing.checkId);
    const racingCheck = await readCheck(racing);
    assert.equal(racingCheck.status, "handled");
    assert.equal(racingCheck.acoustic_assessment, null);
    assertions.push("Stale and human-handled cases cannot be modified, including a human handling the case while recording inference is running.");
    const abandoned = await createFixture("expired worker lease", "I need a ride to leave.", segments, stereo);
    await callback("call_analyzed", abandoned.call);
    const oldToken = randomUUID();
    const claimed = await db.rpc("claim_heartbeat_rehearsal_acoustic", { p_request_id: abandoned.requestId,
      p_call_id: abandoned.call.call_id, p_token: oldToken });
    assert.equal(claimed.error, null);
    assert.equal(claimed.data.claimed, true);
    const lookupsBeforeLease = counters.providerLookups;
    await processRehearsalAcoustics(abandoned.checkId);
    assert.equal(counters.providerLookups, lookupsBeforeLease, "An active worker lease cannot be stolen.");
    const expired = await db.from("heartbeat_rehearsals").update({ acoustic_lease_until: new Date(Date.now() - 1000).toISOString() })
      .eq("request_id", abandoned.requestId);
    if (expired.error) throw new Error(expired.error.message);
    await processRehearsalAcoustics(abandoned.checkId);
    assert.equal((await requireRow(abandoned)).acoustic_status, "available");
    assert.equal((await requireRow(abandoned)).acoustic_attempts, 2);
    const completed = await readCheck(abandoned);
    const staleFinish = await db.rpc("finish_heartbeat_rehearsal_acoustic", { p_request_id: abandoned.requestId,
      p_call_id: abandoned.call.call_id, p_token: oldToken, p_acoustic: completed.acoustic_assessment,
      p_priority: completed.priority_assessment, p_retry: false });
    assert.equal(staleFinish.error, null);
    assert.equal(staleFinish.data.skipped, "stale_lease");
    assert.deepEqual(await readCheck(abandoned), completed);
    assertions.push("Active worker leases prevent parallel inference; expired leases recover within the attempt limit and superseded workers cannot overwrite the completed result.");
    if (before.data.length) {
      for (let offset = 0; offset < before.data.length; offset += 100) {
        const batch = before.data.slice(offset, offset + 100);
        const after = await db.from("checks").select("id,updated_at").in("id", batch.map((row) => row.id));
        if (after.error) throw new Error(after.error.message);
        assert.deepEqual(new Map(after.data.map((row) => [row.id, row.updated_at])), new Map(batch.map((row) => [row.id, row.updated_at])));
      }
    }
    assert.equal(process.env.MOCK_RETELL, "true");
    assertions.push("Unrelated case rows remain unchanged and the fictional roster stays in global mock mode.");
    success = true;
  } catch (error) { failure = error instanceof Error ? error.message : "Verification failed"; }
  finally {
    globalThis.fetch = realFetch;
    if (fixtures.length) {
      const events = await db.from("events").delete().in("id", fixtures.map((fixture) => fixture.eventId));
      if (events.error) cleanupErrors.push(events.error.message);
      const clients = await db.from("clients").delete().in("id", fixtures.map((fixture) => fixture.clientId));
      if (clients.error) cleanupErrors.push(clients.error.message);
    }
    const report = { passed: success && cleanupErrors.length === 0, completedAt: new Date().toISOString(),
      mode: "Synthetic signed provider fixtures with actual local database, local waveform/model inference, and deterministic lifecycle fixtures",
      liveRetellPhoneCallVerified: false, acousticAccuracyVerified: false, ...counters, assertions, observations,
      fixturesCleanedUp: cleanupErrors.length === 0, ...(failure ? { failure } : {}), ...(cleanupErrors.length ? { cleanupErrors } : {}) };
    await mkdir("output/rehearsal", { recursive: true });
    await writeFile("output/rehearsal/acoustic-verification.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ ...report, observations: observations.length }, null, 2));
  }
  if (!success || cleanupErrors.length) throw new Error(failure ?? "Fixture cleanup failed");
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Rehearsal acoustic verification failed."); process.exitCode = 1; });
