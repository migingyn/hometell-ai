// Uses the existing local database. Every non-database request is intercepted.
// Only this script's fictional rows are changed or removed; no calls are placed.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase";
import { startDisasterDemo } from "../lib/demo/disaster";
import { POST as prepare } from "../app/api/demo/rehearsal/prepare/route";
import { POST as start } from "../app/api/demo/rehearsal/route";

type Fixture = { sessionId: string; eventId: string; dailyEventId: string; checkId: string; requestId: string; permit: string };
const db = supabaseAdmin();
const fixtures: Fixture[] = [];
const fixtureAgent = "global_guard_verification_fixture";
const originalFetch = globalThis.fetch;
let providerRequests = 0;
let providerReads = 0;
let providerReadMode: "ongoing" | "ended" | "unavailable" | "mismatch" = "ongoing";
const providerCalls = new Map<string, { call_id: string; agent_id: string; metadata: Record<string, string> }>();

function request(path: string, body: unknown, permit?: string) {
  return new Request(`http://127.0.0.1:3018${path}`, { method: "POST", headers: {
    "Content-Type": "application/json", Origin: "http://127.0.0.1:3018", "Sec-Fetch-Site": "same-origin",
    ...(permit ? { "X-Heartbeat-Rehearsal-Permit": permit } : {}),
  }, body: JSON.stringify(body) });
}
function call(fixture: Fixture) {
  return start(request("/api/demo/rehearsal", { sessionId: fixture.sessionId, eventId: fixture.eventId,
    checkId: fixture.checkId, requestId: fixture.requestId, confirmed: true }, fixture.permit));
}
async function patchFixture(fixture: Fixture, values: Record<string, unknown>) {
  const result = await db.from("heartbeat_rehearsals").update(values)
    .eq("request_id", fixture.requestId).eq("agent_id", fixtureAgent).select("request_id");
  assert.equal(result.error, null);
  assert.equal(result.data?.length, 1, "Only the bound verification fixture may change");
}
async function makeFixture(): Promise<Fixture> {
  const sessionId = randomUUID();
  const demo = await startDisasterDemo(sessionId);
  const fixture = { sessionId, eventId: demo.eventId, dailyEventId: demo.dailyEventId, checkId: "", requestId: randomUUID(), permit: "" };
  fixtures.push(fixture);
  const { data: cases, error } = await db.from("checks").select("id,client:clients(name)").eq("event_id", fixture.eventId);
  assert.equal(error, null);
  fixture.checkId = cases!.find(row => (row.client as unknown as { name: string }).name === "Rosa Alvarez")!.id;
  const response = await prepare(request("/api/demo/rehearsal/prepare", { sessionId, eventId: fixture.eventId,
    checkId: fixture.checkId, requestId: fixture.requestId, phone: "(202) 555-0199" }));
  const prepared = await response.json();
  assert.equal(response.status, 200, JSON.stringify(prepared));
  assert.equal(prepared.data.callsPlaced, 0);
  assert.equal(prepared.data.demo.done, true);
  fixture.permit = prepared.data.permit;
  return fixture;
}

async function main() {
  const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  assert.ok(database.protocol === "http:" && ["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(process.env.MOCK_RETELL, "true");
  const { data: existing, error: readError } = await db.from("heartbeat_rehearsals")
    .select("status,call_finished_at,updated_at");
  assert.equal(readError, null, "Apply migration 009 to the existing local database first");
  assert.ok(!(existing ?? []).some(row => ["reserved", "requested", "ongoing", "unknown", "error"].includes(row.status)),
    "A non-fixture attempt is active or unresolved; leave it untouched and verify later");
  assert.ok(!(existing ?? []).some(row => Date.parse(row.call_finished_at ?? row.updated_at) > Date.now() - 60_000),
    "An existing terminal call is in cooldown; leave it untouched and verify later");

  // Process-local fixture configuration. Never writes an environment file.
  process.env.HEARTBEAT_REHEARSAL_ENABLED = "true";
  process.env.RETELL_API_KEY = "global-guard-fixture-key";
  process.env.RETELL_REHEARSAL_AGENT_ID = fixtureAgent;
  process.env.RETELL_FROM_NUMBER = "+12025550198";
  process.env.HEARTBEAT_REHEARSAL_TOKEN = "global-guard-fixture-server-key-24";
  delete process.env.HEARTBEAT_REHEARSAL_PHONE;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === database.origin) return originalFetch(input, init);
    // Fail closed: no external network request can leave this process.
    if (url.origin === "https://api.retellai.com" && url.pathname.startsWith("/v2/get-call/")) {
      assert.equal(init?.method, "GET");
      const stored = providerCalls.get(decodeURIComponent(url.pathname.slice("/v2/get-call/".length)));
      assert.ok(stored, "Only this script's fixture calls may be inspected");
      providerReads++;
      if (providerReadMode === "unavailable") return Response.json({ error: "Fixture unavailable" }, { status: 503 });
      return Response.json({ ...stored,
        agent_id: providerReadMode === "mismatch" ? "unrelated-agent" : stored.agent_id,
        call_status: providerReadMode === "ongoing" ? "ongoing" : "ended",
        disconnection_reason: providerReadMode === "ongoing" ? undefined : "agent_hangup",
        transcript_object: [{ role: "user", content: "I need a ride." }],
        // Analysis alone must never unlock a call which the provider says is ongoing.
        ...(providerReadMode === "ongoing" ? { call_analysis: { call_summary: "Fixture partial summary" } } : {}),
      });
    }
    assert.equal(url.href, "https://api.retellai.com/v2/create-phone-call");
    providerRequests++;
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.to_number, "+12025550199");
    assert.equal(payload.override_agent_id, fixtureAgent);
    assert.ok(fixtures.some(fixture => fixture.checkId === payload.metadata.check_id));
    const callId = `call_global_guard_fixture_${payload.metadata.rehearsal_request_id}`;
    providerCalls.set(callId, { call_id: callId, agent_id: fixtureAgent, metadata: payload.metadata });
    await new Promise(resolve => setTimeout(resolve, 100));
    return Response.json({ call_id: callId, call_status: "registered" });
  };

  try {
    const pair = await Promise.all([makeFixture(), makeFixture()]);
    assert.equal(providerRequests, 0);
    const responses = await Promise.all(pair.map(call));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    assert.equal(providerRequests, 1, "Different sessions and requests must produce exactly one intercepted call");
    const winner = pair[responses.findIndex(response => response.status === 200)];
    const loser = pair[responses.findIndex(response => response.status === 409)];
    const blocked = await responses.find(response => response.status === 409)!.json();
    assert.match(blocked.error, /Another teammate call is active/);
    const repeated = await call(winner);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).data.duplicate, true);
    assert.equal(providerRequests, 1, "Same-request retry returns the existing reservation without redial");

    const old = new Date(Date.now() - 86_400_000).toISOString();
    for (const status of ["reserved", "requested", "ongoing", "unknown", "error"]) {
      await patchFixture(winner, { status, created_at: old, updated_at: old });
      const retry = await call(loser);
      assert.equal(retry.status, 409, `${status} must block across events regardless of age`);
      if (["unknown", "error"].includes(status)) assert.match((await retry.json()).error, /unconfirmed outcome/);
    }
    assert.equal(providerRequests, 1);
    assert.ok(providerReads >= 5, "Stale bound attempts are checked against the provider");

    for (const mode of ["unavailable", "mismatch"] as const) {
      providerReadMode = mode;
      await patchFixture(winner, { status: "requested", updated_at: old });
      assert.equal((await call(loser)).status, 409, `${mode} evidence must never release a reservation`);
      assert.equal(providerRequests, 1);
    }

    const winnerCallId = `call_global_guard_fixture_${winner.requestId}`;
    await patchFixture(winner, { status: "unknown", call_id: null, updated_at: old });
    const readsBeforeUnbound = providerReads;
    assert.equal((await call(loser)).status, 409, "An unbound request cannot be recovered automatically");
    assert.equal(providerReads, readsBeforeUnbound);

    // Recover a missed callback in a different case using bound provider evidence.
    providerReadMode = "ended";
    await patchFixture(winner, { status: "requested", call_id: winnerCallId, updated_at: old });
    const cooldown = await call(loser);
    assert.equal(cooldown.status, 409);
    assert.match((await cooldown.json()).error, /Wait 60 seconds/);
    const { data: firstEnd } = await db.from("heartbeat_rehearsals").select("status,transcript,call_finished_at").eq("request_id", winner.requestId).single();
    assert.equal(firstEnd?.status, "ended", "Provider-confirmed completion releases the stale active status");
    assert.match(firstEnd?.transcript ?? "", /I need a ride/);
    assert.ok(firstEnd?.call_finished_at, "Recovery still starts the terminal cooldown");
    await patchFixture(winner, { status: "analyzed", updated_at: new Date().toISOString() });
    const { data: analyzed } = await db.from("heartbeat_rehearsals").select("call_finished_at").eq("request_id", winner.requestId).single();
    assert.equal(analyzed?.call_finished_at, firstEnd?.call_finished_at, "Analysis must not restart cooldown");
    assert.equal((await call(loser)).status, 409);
    assert.equal(providerRequests, 1);

    await patchFixture(winner, { call_finished_at: new Date(Date.now() - 61_000).toISOString(), updated_at: new Date().toISOString() });
    const afterCooldown = await call(loser);
    assert.equal(afterCooldown.status, 200, await afterCooldown.clone().text());
    assert.equal(providerRequests, 2, "A new call is allowed after a confirmed terminal attempt's cooldown");
    console.log(JSON.stringify({ passed: true, actualCallsPlaced: 0, crossSessionRace: { starts: 2, interceptedProviderRequests: 1, statuses: [200, 409] },
      sameRequestIdempotent: true, ageDoesNotReleaseActiveOrUnknown: true, staleCallRecoveredFromProvider: true,
      unavailableMismatchedAndUnboundStayBlocked: true, terminalCooldownSeconds: 60, lateEvidenceDoesNotExtendCooldown: true }));
  } finally {
    for (const fixture of fixtures) {
      const { data: patients } = await db.from("clients").select("id").eq("emergency_contact_name", `Fictional replay contact [${fixture.sessionId}]`);
      const deletion = await db.from("events").delete().in("id", [fixture.eventId, fixture.dailyEventId]);
      assert.equal(deletion.error, null);
      if (patients?.length) assert.equal((await db.from("clients").delete().in("id", patients.map(row => row.id))).error, null);
    }
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Call guard verification failed."); process.exitCode = 1; });
