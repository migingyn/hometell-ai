import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { dialPrescriptionSource, phoneReadiness } from "./phone";

const KEYS = ["RETELL_API_KEY", "RETELL_FROM_NUMBER", "RETELL_AGENT_ID", "PRESCRIPTION_PUBLIC_URL", "PRESCRIPTION_DEMO_CONTACTS"] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const numbers = { pharmacy: "+12025550101", insurer: "+12025550102", clinic: "+12025550103" };

beforeEach(() => {
  process.env.RETELL_API_KEY = "prescription-test-secret";
  process.env.RETELL_FROM_NUMBER = "+12025550104";
  process.env.RETELL_AGENT_ID = "agent_prescription_test";
  process.env.PRESCRIPTION_PUBLIC_URL = "https://prescription.example.com";
  process.env.PRESCRIPTION_DEMO_CONTACTS = JSON.stringify(numbers);
});

afterEach(() => {
  mock.restoreAll();
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test("phone readiness checks configuration locally without calls or secret disclosure", () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  assert.deepEqual(phoneReadiness(), { ready: true, missing: [] });
  delete process.env.RETELL_API_KEY;
  assert.deepEqual(phoneReadiness(), { ready: false, missing: ["RETELL_API_KEY"] });
  assert.equal(request.mock.callCount(), 0);
});

test("missing provider credentials or malformed consenting contact directory never provisions or dials", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  for (const key of KEYS) {
    const value = process.env[key];
    delete process.env[key];
    assert.equal(phoneReadiness().ready, false);
    await assert.rejects(dialPrescriptionSource({ sessionId: "session-test", role: "clinic" }), /not configured/);
    process.env[key] = value;
  }
  for (const contacts of ["{broken", "null", "[]", JSON.stringify({ ...numbers, pharmacy: "911" }), JSON.stringify({ clinic: numbers.clinic })]) {
    process.env.PRESCRIPTION_DEMO_CONTACTS = contacts;
    assert.equal(phoneReadiness().ready, false);
    await assert.rejects(dialPrescriptionSource({ sessionId: "session-test", role: "pharmacy" }), /not configured/);
  }
  assert.equal(request.mock.callCount(), 0);
});

test("unsafe public callback URLs are rejected before provisioning or dialing", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  for (const url of ["http://public.example.com", "https://localhost", "https://127.0.0.1", "https://2130706433", "https://10.0.0.1", "https://[::1]", "https://private.local", "https://user:secret@public.example.com", "https://public.example.com/path", "https://public.example.com?token=private"]) {
    process.env.PRESCRIPTION_PUBLIC_URL = url;
    assert.ok(phoneReadiness().missing.includes("PRESCRIPTION_PUBLIC_URL"));
    await assert.rejects(dialPrescriptionSource({ sessionId: "session-test", role: "pharmacy" }), /not configured/);
  }
  assert.equal(request.mock.callCount(), 0);
});

test("actual Retell requests use an isolated source engine and return only real call ID", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer prescription-test-secret");
    const body = JSON.parse(String(init?.body));
    const url = String(input);
    requests.push({ url, body });
    return url.endsWith("/create-retell-llm")
      ? Response.json({ llm_id: "llm_isolated_source", version: 0 })
      : Response.json({ call_id: "call_real_prescription", call_status: "registered" });
  });
  assert.deepEqual(await dialPrescriptionSource({ sessionId: "session-123", role: "insurer" }), { callId: "call_real_prescription" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.retellai.com/create-retell-llm");
  const engine = requests[0].body;
  assert.match(String(engine.general_prompt), /explicit yes/);
  assert.match(String(engine.general_prompt), /fictional/);
  assert.match(String(engine.general_prompt), /Do not provide medication/);
  assert.doesNotMatch(String(engine.general_prompt), /disaster|evacuation|check.?in/i);
  assert.match(String(engine.begin_message), /teammate roleplay/);
  const tools = engine.general_tools as { name: string; url: string; parameters: { properties: { kind: { enum: string[] } } } }[];
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "report_source_update");
  assert.equal(tools[0].url, "https://prescription.example.com/api/prescription/retell");
  assert.ok(tools[0].parameters.properties.kind.enum.includes("insurer_received"));
  assert.ok(!tools[0].parameters.properties.kind.enum.includes("pharmacy_ready"));
  assert.equal(requests[1].url, "https://api.retellai.com/v2/create-phone-call");
  const call = requests[1].body;
  assert.equal(call.from_number, "+12025550104");
  assert.equal(call.to_number, numbers.insurer);
  assert.equal(call.override_agent_id, "agent_prescription_test");
  assert.deepEqual(call.metadata, { prescription_session_id: "session-123", prescription_role: "insurer" });
  const overrides = call.agent_override as { agent: Record<string, unknown>; retell_llm: Record<string, unknown> };
  assert.deepEqual(overrides.agent.response_engine, { type: "retell-llm", llm_id: "llm_isolated_source", version: 0 });
  assert.equal(overrides.agent.max_call_duration_ms, 180_000);
  assert.deepEqual(overrides.agent.pre_session_tools, []);
  assert.deepEqual(overrides.agent.post_session_tools, []);
  assert.equal(overrides.agent.webhook_url, tools[0].url);
  assert.equal("general_prompt" in overrides.retell_llm, false);
  assert.equal("general_tools" in overrides.retell_llm, false);
  assert.match(String(call.idempotency_key), /^[A-Za-z0-9_-]{5,255}$/);
  assert.equal(JSON.stringify(call).includes("prescription-test-secret"), false);
});

test("each source role receives only its own administrative evidence kinds", async () => {
  const kinds: Record<string, string[]> = {};
  let currentRole = "";
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/create-retell-llm")) {
      const body = JSON.parse(String(init?.body));
      kinds[currentRole] = body.general_tools[0].parameters.properties.kind.enum;
      return Response.json({ llm_id: "llm_source" });
    }
    return Response.json({ call_id: `call_${currentRole}` });
  });
  for (const role of ["clinic", "pharmacy", "insurer"] as const) {
    currentRole = role;
    await dialPrescriptionSource({ sessionId: "session-123", role });
  }
  assert.ok(kinds.clinic.includes("clinic_resent"));
  assert.ok(kinds.pharmacy.includes("pharmacy_blocked"));
  assert.ok(kinds.insurer.includes("insurer_approved"));
  assert.ok(!kinds.clinic.includes("insurer_approved"));
  assert.ok(!kinds.insurer.includes("pharmacy_ready"));
});

test("idempotency key is stable per session and role and differs between sources", async () => {
  const keys: string[] = [];
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/create-retell-llm")) return Response.json({ llm_id: "llm_source" });
    keys.push(JSON.parse(String(init?.body)).idempotency_key);
    return Response.json({ call_id: "call_real" });
  });
  await dialPrescriptionSource({ sessionId: "session-123", role: "clinic" });
  await dialPrescriptionSource({ sessionId: "session-123", role: "clinic" });
  await dialPrescriptionSource({ sessionId: "session-123", role: "pharmacy" });
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});

test("provider errors and invalid identifiers never fabricate phone success or echo private response bodies", async () => {
  mock.method(globalThis, "fetch", async () => new Response("private number +12025550101 and prescription-test-secret", { status: 401 }));
  await assert.rejects(dialPrescriptionSource({ sessionId: "session-123", role: "clinic" }), (error: unknown) => {
    const message = (error as Error).message;
    assert.match(message, /401/);
    assert.doesNotMatch(message, /1202555|prescription-test-secret/);
    return true;
  });
  mock.restoreAll();
  const request = mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(dialPrescriptionSource({ sessionId: "session-123", role: "clinic" }), /did not create.*No call was placed/);
  assert.equal(request.mock.callCount(), 1);
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => String(input).endsWith("/create-retell-llm")
    ? Response.json({ llm_id: "llm_source" }) : Response.json({ call_status: "registered" }));
  await assert.rejects(dialPrescriptionSource({ sessionId: "session-123", role: "clinic" }), /did not confirm a call ID/);
});

test("invalid session identifiers and source roles do not contact Retell", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  await assert.rejects(dialPrescriptionSource({ sessionId: "", role: "clinic" }), /valid prescription session/);
  await assert.rejects(dialPrescriptionSource({ sessionId: "session-123", role: "unknown" as "clinic" }), /valid prescription session/);
  assert.equal(request.mock.callCount(), 0);
});
