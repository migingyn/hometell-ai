import assert from "node:assert/strict";
import { test, mock, afterEach } from "node:test";
import { assertPresenterToken, rehearsalFinalResult, rehearsalPhonePayload, rehearsalReadiness, rehearsalRecording, RehearsalInput, publicRehearsal, type RehearsalRow } from "./rehearsal";

afterEach(() => mock.restoreAll());

const input = { sessionId: "11111111-1111-4111-a111-111111111111", eventId: "22222222-2222-4222-a222-222222222222",
  checkId: "33333333-3333-4333-a333-333333333333", requestId: "44444444-4444-4444-a444-444444444444", confirmed: true as const };
const env = { HEARTBEAT_REHEARSAL_ENABLED: "true", RETELL_API_KEY: "test-key", RETELL_REHEARSAL_AGENT_ID: "dedicated-test",
  RETELL_FROM_NUMBER: "+12025550101", HEARTBEAT_REHEARSAL_PHONE: "+12025550102", HEARTBEAT_REHEARSAL_TOKEN: "private-test-token-at-least-24" };

test("single-call request cannot choose a telephone number or omit consent", () => {
  assert.equal(RehearsalInput.safeParse(input).success, true);
  assert.equal(RehearsalInput.safeParse({ ...input, confirmed: false }).success, false);
  assert.equal(RehearsalInput.safeParse({ ...input, phone: "+12025550199" }).success, false);
  assert.throws(() => assertPresenterToken(null, env.HEARTBEAT_REHEARSAL_TOKEN), /presenter token/);
  assert.throws(() => assertPresenterToken("incorrect", env.HEARTBEAT_REHEARSAL_TOKEN), /presenter token/);
  assert.doesNotThrow(() => assertPresenterToken(env.HEARTBEAT_REHEARSAL_TOKEN, env.HEARTBEAT_REHEARSAL_TOKEN));
});

test("readiness requires explicit enabled flag and separate fixed recipient/agent", () => {
  assert.equal(rehearsalReadiness(env).configured, true);
  assert.equal(rehearsalReadiness({ ...env, HEARTBEAT_REHEARSAL_ENABLED: "false" }).configured, false);
  assert.equal(rehearsalReadiness({ ...env, HEARTBEAT_REHEARSAL_PHONE: env.RETELL_FROM_NUMBER }).configured, false);
  assert.equal(rehearsalReadiness({ ...env, RETELL_DAILY_AGENT_ID: env.RETELL_REHEARSAL_AGENT_ID }).configured, false);
});

test("provider payload fixes recipient and keeps rehearsal text separate from replay identifiers", () => {
  const first = rehearsalPhonePayload(input, "Demo resident", env);
  assert.equal(first.to_number, env.HEARTBEAT_REHEARSAL_PHONE);
  assert.equal(first.override_agent_id, env.RETELL_REHEARSAL_AGENT_ID);
  assert.equal(first.idempotency_key, rehearsalPhonePayload(input, "Demo resident", env).idempotency_key);
  assert.deepEqual(first.metadata, { rehearsal_request_id: input.requestId, check_id: input.checkId, target: "client", mode: "crisis" });
  assert.doesNotMatch(first.retell_llm_dynamic_variables.alert_text, /11111111|SIMULATED DISASTER REPLAY/);
  assert.match(first.retell_llm_dynamic_variables.alert_text, /fictional/);
});

test("real classification ignores mock outcome and never schedules another outbound attempt", () => {
  const call = { call_id: "call_test", call_status: "ended", metadata: { check_id: input.checkId, target: "client" as const, mock_outcome: "ok" as const },
    transcript: "User: I need help leaving my home.", call_analysis: { custom_analysis_data: { client_status: "needs_help", request: "I need help leaving my home." } } };
  const result = rehearsalFinalResult(call);
  assert.equal(result.status, "needs_human");
  assert.equal(result.next_action_at, null);
  for (const reason of ["dial_no_answer", "network_blocked", "error_llm_websocket_lost_connection", "max_duration_reached", "manual_stopped"]) {
    const failed = rehearsalFinalResult({ ...call, transcript: "User: I am okay.", disconnection_reason: reason,
      call_analysis: { custom_analysis_data: { client_status: "ok" } } });
    assert.equal(failed.status, "needs_human", reason);
    assert.equal(failed.next_action_at, null);
  }
});

test("okay requires actual caller wellbeing and independent mobility evidence", () => {
  const base = { call_id: "call_test", call_status: "ended", disconnection_reason: "user_hangup", call_analysis: { custom_analysis_data: {
    client_status: "ok", needs_ride: false, needs_ride_quote: "I can leave on my own." } } };
  for (const transcript_object of [[], [{ role: "agent", content: "I am okay. I can leave on my own." }],
    [{ role: "user", content: "Yes." }], [{ role: "user", content: "I am okay." }],
    [{ role: "user", content: "I can leave on my own." }],
    [{ role: "user", content: "I am okay?" }, { role: "user", content: "I can leave on my own." }]]) {
    assert.equal(rehearsalFinalResult({ ...base, transcript_object }).status, "needs_human");
  }
  const transcript_object = [{ role: "user", content: "I am okay." }, { role: "user", content: "I can leave on my own." }];
  assert.equal(rehearsalFinalResult({ ...base, transcript_object }).status, "ok");
  assert.equal(rehearsalFinalResult({ ...base, transcript_object: [], transcript: "User: I am okay.\nUser: I can leave on my own." }).status, "needs_human", "Empty structured transcript remains authoritative");
});

test("public rehearsal contains no raw provider record or configuration", () => {
  const row = { request_id: input.requestId, session_id: input.sessionId, event_id: input.eventId, check_id: input.checkId,
    agent_id: "private-agent", call_id: "call_test", status: "analyzed", turns: [{ role: "user", content: "I need a ride." }],
    transcript: "User: I need a ride.", turn_count: 1, recording_available: true, updated_at: "2026-10-17T00:00:00Z",
    raw: { call: { call_id: "call_test", recording_url: "https://private.example/secret" } } } as RehearsalRow;
  const value = publicRehearsal(row)!;
  assert.equal(value.simulated, false);
  assert.equal(value.audioUrl, `/api/demo/rehearsal/recording?checkId=${input.checkId}`);
  assert.doesNotMatch(JSON.stringify(value), /private-agent|private.example|secret/);
});

test("recording requires the bound provider call and an approved host before downloading", async () => {
  const row = { call_id: "call_test", request_id: input.requestId, agent_id: "private-agent" } as RehearsalRow;
  let variant = "wrong-call";
  const request = mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(String(url), "https://api.retellai.com/v2/get-call/call_test");
    return Response.json({ call_id: variant === "wrong-call" ? "different-call" : "call_test", agent_id: "private-agent",
      metadata: { rehearsal_request_id: input.requestId }, recording_url: "https://127.0.0.1/private-audio" });
  });
  await assert.rejects(rehearsalRecording(row), /binding mismatch/);
  variant = "private-host";
  await assert.rejects(rehearsalRecording(row), /not approved/);
  assert.equal(request.mock.callCount(), 2, "No untrusted recording host was fetched");
});

test("recording playback returns bounded actual audio without redirecting to provider URLs", async () => {
  const row = { call_id: "call_test", request_id: input.requestId, agent_id: "private-agent" } as RehearsalRow;
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    if (String(url).startsWith("https://api.retellai.com/")) return Response.json({ call_id: "call_test", agent_id: "private-agent",
      metadata: { rehearsal_request_id: input.requestId }, recording_url: "https://retellai.s3.us-west-2.amazonaws.com/test.wav" });
    assert.equal(String(url), "https://retellai.s3.us-west-2.amazonaws.com/test.wav");
    return new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "Content-Type": "audio/wav", "Content-Length": "4" } });
  });
  const result = await rehearsalRecording(row);
  assert.equal(result.contentType, "audio/wav");
  assert.deepEqual([...result.bytes], [82, 73, 70, 70]);
});
