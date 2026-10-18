// Local setup + call-start integration. Every telephony request is intercepted.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase";
import { startDisasterDemo } from "../lib/demo/disaster";
import { POST as prepare } from "../app/api/demo/rehearsal/prepare/route";
import { POST as start } from "../app/api/demo/rehearsal/route";

async function main() {
  const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(process.env.MOCK_RETELL, "true");
  // These fixture settings exist only in this process; private config is unchanged.
  process.env.HEARTBEAT_REHEARSAL_ENABLED = "true";
  process.env.RETELL_REHEARSAL_AGENT_ID = "setup_fixture_agent";
  process.env.RETELL_FROM_NUMBER = "+12025550198";
  process.env.HEARTBEAT_REHEARSAL_TOKEN = "setup-fixture-server-key-only-24";
  delete process.env.HEARTBEAT_REHEARSAL_PHONE;
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  const sessionId = randomUUID(), requestId = randomUUID();
  let eventId = "", dailyEventId = "", checkId = "";
  const db = supabaseAdmin();
  const { data: existing, error: readError } = await db.from("heartbeat_rehearsals").select("status,call_finished_at,updated_at");
  assert.equal(readError, null);
  assert.ok(!(existing ?? []).some(row => ["reserved", "requested", "ongoing", "unknown", "error"].includes(row.status)), "An existing call is active or unresolved; leave it untouched and verify later");
  assert.ok(!(existing ?? []).some(row => Date.parse(row.call_finished_at ?? row.updated_at) > Date.now() - 60_000), "An existing call is in cooldown; leave it untouched and verify later");
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === database.origin) return originalFetch(input, init);
    // Fail closed for ALL other network requests, including unexpected provider endpoints.
    assert.equal(url.href, "https://api.retellai.com/v2/create-phone-call");
    providerRequests++;
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.to_number, "+12025550199");
    assert.equal(payload.override_agent_id, "setup_fixture_agent");
    assert.equal(payload.metadata.check_id, checkId);
    return Response.json({ call_id: `call_setup_fixture_${payload.metadata.rehearsal_request_id}`, call_status: "registered" });
  };
  function request(path: string, body: unknown, headers: Record<string, string> = {}) {
    return new Request(`http://127.0.0.1:3018${path}`, { method: "POST", headers: {
      "Content-Type": "application/json", Origin: "http://127.0.0.1:3018", "Sec-Fetch-Site": "same-origin", ...headers,
    }, body: JSON.stringify(body) });
  }
  try {
    const demo = await startDisasterDemo(sessionId);
    eventId = demo.eventId; dailyEventId = demo.dailyEventId;
    const { data: cases, error } = await db.from("checks").select("id,client:clients(name)").eq("event_id", eventId);
    assert.equal(error, null);
    const rosa = cases!.find(row => (row.client as unknown as { name: string }).name === "Rosa Alvarez");
    assert.ok(rosa); checkId = rosa.id;
    const setup = { sessionId, eventId, checkId, requestId, phone: "(202) 555-0199" };
    assert.equal((await prepare(request("/api/demo/rehearsal/prepare", setup, { Origin: "https://example.com" }))).status, 403);
    assert.equal((await prepare(request("/api/demo/rehearsal/prepare", { ...setup, phone: "911" }))).status, 400);
    assert.equal((await prepare(request("/api/demo/rehearsal/prepare", { ...setup, sessionId: randomUUID() }))).status, 404);
    const preparedResponse = await prepare(request("/api/demo/rehearsal/prepare", setup));
    const prepared = await preparedResponse.json();
    assert.equal(preparedResponse.status, 200, JSON.stringify(prepared));
    assert.equal(prepared.data.demo.done, true);
    assert.equal(prepared.data.demo.step, 5);
    assert.equal(prepared.data.callsPlaced, 0);
    assert.equal(providerRequests, 0, "Preparing must never contact telephony");
    const headers = { "X-Heartbeat-Rehearsal-Permit": prepared.data.permit };
    const input = { sessionId, eventId, checkId, requestId, confirmed: true };
    assert.equal((await start(request("/api/demo/rehearsal", { ...input, confirmed: false }, headers))).status, 400);
    assert.equal((await start(request("/api/demo/rehearsal", { ...input, checkId: randomUUID() }, headers))).status, 403);
    assert.equal((await start(request("/api/demo/rehearsal", { ...input, phone: "+12025550100" }, headers))).status, 400);
    const responses = await Promise.all([start(request("/api/demo/rehearsal", input, headers)), start(request("/api/demo/rehearsal", input, headers))]);
    for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
    const results = await Promise.all(responses.map(response => response.json()));
    assert.equal(results.filter(result => !result.data.duplicate).length, 1);
    assert.equal(results.filter(result => result.data.duplicate).length, 1);
    assert.equal(providerRequests, 1, "Concurrent starts must issue exactly one intercepted provider request");
    assert.equal((await prepare(request("/api/demo/rehearsal/prepare", { ...setup, requestId: randomUUID() }))).status, 409);

    // A different resident in the SAME scenario must no longer hit a lifetime quota.
    const harold = cases!.find(row => (row.client as unknown as { name: string }).name === "Harold Chen");
    assert.ok(harold); checkId = harold.id;
    const nextSetup = { ...setup, checkId, requestId: randomUUID() };
    const nextPreparedResponse = await prepare(request("/api/demo/rehearsal/prepare", nextSetup));
    const nextPrepared = await nextPreparedResponse.json();
    assert.equal(nextPreparedResponse.status, 200, JSON.stringify(nextPrepared));
    const nextHeaders = { "X-Heartbeat-Rehearsal-Permit": nextPrepared.data.permit };
    const nextInput = { ...input, checkId, requestId: nextSetup.requestId };
    const active = await start(request("/api/demo/rehearsal", nextInput, nextHeaders));
    assert.equal(active.status, 409);
    assert.match((await active.json()).error, /Another teammate call is active/);
    assert.equal(providerRequests, 1);

    const fixtureTurns = [{ role: "user", content: "Fixture conversation preserved." }];
    const ended = await db.from("heartbeat_rehearsals").update({ status: "analyzed", turns: fixtureTurns,
      transcript: "User: Fixture conversation preserved.", turn_count: 1, call_finished_at: new Date(Date.now() - 61_000).toISOString() })
      .eq("request_id", requestId).eq("agent_id", "setup_fixture_agent").select("request_id");
    assert.equal(ended.error, null); assert.equal(ended.data?.length, 1);
    const nextStart = await start(request("/api/demo/rehearsal", nextInput, nextHeaders));
    assert.equal(nextStart.status, 200, await nextStart.clone().text());
    assert.equal(providerRequests, 2, "Two residents in one scenario can each receive an explicitly requested call");
    const { data: attempts, error: attemptsError } = await db.from("heartbeat_rehearsals").select("request_id,check_id,turns,transcript").eq("event_id", eventId);
    assert.equal(attemptsError, null); assert.equal(attempts?.length, 2);
    assert.deepEqual(attempts!.find(row => row.request_id === requestId)!.turns, fixtureTurns);
    assert.equal(attempts!.find(row => row.request_id === requestId)!.transcript, "User: Fixture conversation preserved.");
    assert.equal((await start(request("/api/demo/rehearsal", nextInput, nextHeaders))).status, 200);
    assert.equal(providerRequests, 2, "Repeated request remains idempotent");
    console.log("Call setup verified: multiple residents in the same scenario, retained prior evidence, consent and recipient binding, active-call guard, and duplicate protection. No calls placed.");
  } finally {
    const { data: patients } = await db.from("clients").select("id").eq("emergency_contact_name", `Fictional replay contact [${sessionId}]`);
    if (eventId || dailyEventId) await db.from("events").delete().in("id", [eventId, dailyEventId].filter(Boolean));
    if (patients?.length) await db.from("clients").delete().in("id", patients.map(row => row.id));
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Setup verification failed."); process.exitCode = 1; });
