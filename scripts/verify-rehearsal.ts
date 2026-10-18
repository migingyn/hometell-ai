// Local database + HTTP integration. Provider events are synthetic; no telephone requests.
import "./env";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { supabaseAdmin } from "../lib/supabase";
import { startDisasterDemo, stepDisasterDemo } from "../lib/demo/disaster";
import { readRehearsal, refreshRehearsal, startRehearsal } from "../lib/demo/rehearsal";

const base = new URL(process.env.REHEARSAL_APP_URL ?? "http://127.0.0.1:3018");
const sessionId = randomUUID(), requestId = randomUUID(), agentId = "rehearsal_verification_fixture";
const assertions: string[] = [];
const db = supabaseAdmin();
let checkId = "", eventId = "", dailyId = "";
const callId = `call_rehearsal_fixture_${requestId}`;
async function webhook(event: string, call: Record<string, unknown>, signed = true) {
  const raw = JSON.stringify({ event, call });
  const stamp = Date.now();
  const signature = `v=${stamp},d=${createHmac("sha256", process.env.RETELL_API_KEY!).update(raw + stamp).digest("hex")}`;
  const response = await fetch(new URL("/api/retell/webhook", base), { method: "POST", body: raw,
    headers: { "Content-Type": "application/json", ...(signed ? { "x-retell-signature": signature } : {}) }, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, json: await response.json() };
}
async function reserve(id = requestId, chosenCheck = checkId) {
  return db.rpc("reserve_heartbeat_rehearsal", { p_request_id: id, p_session_id: sessionId, p_event_id: eventId, p_check_id: chosenCheck, p_agent_id: agentId });
}
async function main() {
  assert.equal(process.env.MOCK_RETELL, "true");
  const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  for (const url of [base, database]) assert.ok(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  assert.ok(process.env.RETELL_API_KEY);
  // Child-process-only settings and intercepted transport; no environment file changes.
  process.env.HEARTBEAT_REHEARSAL_ENABLED = "true";
  process.env.RETELL_REHEARSAL_AGENT_ID = agentId;
  process.env.HEARTBEAT_REHEARSAL_PHONE = "+12025550199";
  process.env.HEARTBEAT_REHEARSAL_TOKEN = "local-fixture-presenter-token-24";
  const realFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.retellai.com/")) {
      if (String(input).includes("/v2/get-call/")) throw new Error("Simulated provider lookup outage");
      assert.equal(String(input), "https://api.retellai.com/v2/create-phone-call");
      providerRequests++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.to_number, "+12025550199");
      assert.equal(body.metadata.check_id, checkId);
      return Response.json({ call_id: callId, call_status: "registered" });
    }
    return realFetch(input, init);
  };
  const before = await db.from("checks").select("id,updated_at");
  try {
    const replay = await startDisasterDemo(sessionId);
    eventId = replay.eventId; dailyId = replay.dailyEventId;
    const { data: cases } = await db.from("checks").select("id").eq("event_id", eventId);
    checkId = cases![0].id;
    assert.ok((await reserve()).error, "Cannot reserve before replay finishes");
    for (let step = 0; step < 6; step++) await stepDisasterDemo(sessionId, eventId, step);
    assert.ok((await reserve(randomUUID(), randomUUID())).error);
    const input = { requestId, sessionId, eventId, checkId, confirmed: true as const };
    const parallel = await Promise.all([startRehearsal(input), startRehearsal(input)]);
    assert.equal(parallel.filter((result) => !result.duplicate).length, 1);
    assert.equal(parallel.filter((result) => result.duplicate).length, 1);
    assert.equal(providerRequests, 1, "Exactly one intercepted request reaches the fixed recipient");
    assert.ok((await reserve(randomUUID(), cases![1].id)).error, "An active call blocks a simultaneous second participant");
    assertions.push("Completed owned replay and one-case reservation enforced; concurrent duplicate starts produce exactly one intercepted provider request.");
    const binding = await db.rpc("bind_heartbeat_rehearsal", { p_request_id: requestId, p_call_id: callId, p_uncertain: false });
    assert.equal(binding.error, null);
    const call = { call_id: callId, agent_id: agentId, call_status: "ongoing",
      metadata: { rehearsal_request_id: requestId, check_id: checkId, target: "client", mode: "crisis", mock_outcome: "ok" },
      transcript_object: [{ role: "agent", content: "This is a recorded practice call. Do you need help?" },
        { role: "user", content: "I need a ride to leave my home." }] };
    assert.equal((await webhook("transcript_updated", call, false)).status, 401);
    const noMarker = { ...call, metadata: { check_id: checkId, target: "client" } };
    assert.equal((await webhook("transcript_updated", noMarker, false)).status, 401);
    assert.equal((await webhook("transcript_updated", { ...call, agent_id: "wrong_agent" })).status, 403);
    const live = await webhook("transcript_updated", call);
    assert.equal(live.status, 200, JSON.stringify(live.json));
    assert.equal((await readRehearsal(checkId))!.turns.length, 2);
    const interimLog = await db.from("call_logs").select("id").eq("retell_call_id", callId);
    assert.equal(interimLog.data?.length, 0);
    const older = await webhook("transcript_updated", { ...call, transcript_object: [call.transcript_object[0]] });
    assert.equal(older.status, 200);
    assert.equal((await readRehearsal(checkId))!.turns.length, 2);
    assertions.push("Real-call binding and signatures enforced in global mock mode; interim transcript survives older updates without creating a final log.");
    assert.equal((await webhook("call_ended", { ...call, call_status: "ended" })).status, 200);
    const final = { ...call, call_status: "ended", disconnection_reason: "network_blocked",
      call_analysis: { call_summary: "Practice call interrupted.", custom_analysis_data: { client_status: "ok" } } };
    assert.equal((await webhook("call_analyzed", final)).status, 200);
    assert.equal((await webhook("call_analyzed", { ...final, disconnection_reason: "agent_hangup" })).status, 200);
    const { data: check } = await db.from("checks").select("*").eq("id", checkId).single();
    assert.equal(check.status, "needs_human");
    assert.equal(check.next_action_at, null);
    assert.equal(check.nurse_transfer, null);
    assert.equal(check.ladder_step, 0);
    const finalLogs = await db.from("call_logs").select("id").eq("retell_call_id", callId);
    assert.equal(finalLogs.data?.length, 1);
    assertions.push("Dropped call remains for human review; no automated ladder, old nurse transfer, duplicate final outcome or mock override.");
    const evidenceResponse = await fetch(new URL(`/api/checks/${checkId}/evidence`, base));
    const evidence = (await evidenceResponse.json()).data;
    assert.equal(evidence.callKind, "teammate_rehearsal");
    assert.equal(evidence.simulated, false);
    assert.equal(evidence.priorDailySimulated, true);
    assert.equal(evidence.recordingAvailable, false);
    assert.equal(evidence.audioUrl, null);
    assert.equal(evidence.turns.length, 2);
    assert.equal("raw" in evidence, false);
    assertions.push("Evidence distinguishes test call transport from sample scenario and does not invent a recording.");
    // Age only this private fixture. A failed status lookup must not redial.
    await db.from("heartbeat_rehearsals").update({ status: "requested", updated_at: new Date(Date.now() - 90_000).toISOString() }).eq("request_id", requestId);
    await assert.rejects(refreshRehearsal((await readRehearsal(checkId))!));
    assert.equal((await readRehearsal(checkId))!.status, "unknown");
    assert.equal((await readRehearsal(checkId))!.call_id, callId);
    assert.equal((await startRehearsal(input)).duplicate, true);
    assert.equal(providerRequests, 1);
    await db.from("heartbeat_rehearsals").update({ status: "reserved", call_id: null, updated_at: new Date(Date.now() - 90_000).toISOString() }).eq("request_id", requestId);
    assert.equal((await refreshRehearsal((await readRehearsal(checkId))!)).status, "unknown");
    assert.equal(providerRequests, 1);
    assertions.push("Stale bound requests and unbound reservations become unknown without any automatic redial.");
    const unsignedStart = await fetch(new URL("/api/demo/rehearsal", base), { method: "POST", body: JSON.stringify({ sessionId, eventId, checkId, requestId, confirmed: true }), headers: { "Content-Type": "application/json" } });
    assert.equal(unsignedStart.status, 403);
    if (before.data?.length) {
      const { data: after } = await db.from("checks").select("id,updated_at").in("id", before.data.map((row) => row.id));
      assert.deepEqual(new Map(after?.map((row) => [row.id, row.updated_at])), new Map(before.data.map((row) => [row.id, row.updated_at])));
    }
    assertions.push("Unauthorized start makes no call; unrelated daily and crisis cases remain unchanged.");
  } finally {
    globalThis.fetch = realFetch;
    const { data: patients } = await db.from("clients").select("id").eq("emergency_contact_name", `Fictional replay contact [${sessionId}]`);
    if (eventId || dailyId) await db.from("events").delete().in("id", [eventId, dailyId].filter(Boolean));
    if (patients?.length) await db.from("clients").delete().in("id", patients.map((row) => row.id));
  }
  await mkdir("output/rehearsal", { recursive: true });
  await writeFile("output/rehearsal/verification.json", JSON.stringify({ passed: true, completedAt: new Date().toISOString(), providerEvents: "synthetic signed fixtures", outboundCallsPlaced: false, assertions }, null, 2));
  console.log(`Rehearsal verification passed: ${assertions.length} scenario groups. No calls or texts were placed.`);
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Rehearsal verification failed."); process.exitCode = 1; });
