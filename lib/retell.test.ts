import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, mock, test } from "node:test";
import { config } from "./config";
import { createPhoneCall, getHeartbeatCallingReadiness, getPhoneCall, placeCall, verifyWebhook, verifyRetellSignature } from "./retell";
import { buildLlmUpdate, configureVoiceAgent, validatePublicUrl } from "../scripts/configure-voice-agent";
import { buildSeedClients } from "../scripts/seed";
import { buildFakeWebhook } from "../scripts/fake-webhook";
import { configureHeartbeatAgents, heartbeatAgentPlan, renderHeartbeatAgentDocs, HEARTBEAT_PROMPTS } from "../scripts/configure-heartbeat-agents";
import type { Client } from "./types";
import { POSTOP_ANALYSIS_FIELDS } from "./postop/analysis-schema";
import { buildPostOpAssessment } from "./postop/assessment";
import { POST as startHeartbeatEvent } from "../app/api/events/start/route";

const envKeys = ["RETELL_API_KEY", "RETELL_WEBHOOK_KEY", "RETELL_FROM_NUMBER", "RETELL_AGENT_ID", "VOICE_PUBLIC_URL", "HEARTBEAT_PUBLIC_URL", "APP_URL", "RETELL_DAILY_AGENT_ID", "RETELL_CRISIS_AGENT_ID", "RETELL_DAILY_KO_AGENT_ID", "RETELL_CRISIS_KO_AGENT_ID", "ON_CALL_NURSE_PHONE"] as const;
const priorEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const priorMock = config.mockRetell;

beforeEach(() => {
  config.mockRetell = false;
  process.env.RETELL_API_KEY = "test-retell-secret";
  delete process.env.RETELL_WEBHOOK_KEY;
  process.env.RETELL_FROM_NUMBER = "+12025550101";
  process.env.RETELL_AGENT_ID = "agent_test";
  process.env.VOICE_PUBLIC_URL = "https://voice.example.com";
  delete process.env.HEARTBEAT_PUBLIC_URL;
  delete process.env.ON_CALL_NURSE_PHONE;
  for (const key of ["RETELL_DAILY_AGENT_ID", "RETELL_CRISIS_AGENT_ID", "RETELL_DAILY_KO_AGENT_ID", "RETELL_CRISIS_KO_AGENT_ID"]) delete process.env[key];
});

afterEach(() => {
  mock.restoreAll();
  config.mockRetell = priorMock;
  for (const key of envKeys) {
    if (priorEnv[key] === undefined) delete process.env[key];
    else process.env[key] = priorEnv[key];
  }
});

test("real outbound calls send Retell's documented payload and actual call ID", async () => {
  const request = mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://api.retellai.com/v2/create-phone-call");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-retell-secret");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      from_number: "+12025550101", to_number: "+12025550102", override_agent_id: "agent_delegate",
      metadata: { parent_call_id: "call_primary", delegation_depth: 1 },
      retell_llm_dynamic_variables: { call_role: "delegate", voice_task: "Ask about opening hours" },
      agent_override: { retell_llm: { begin_message: "Hello, I'm an automated assistant asking about opening hours." } },
      idempotency_key: "action_123", honor_internal_dnc: true,
    });
    return Response.json({ call_id: "call_real_123", call_status: "registered" });
  });
  assert.deepEqual(await createPhoneCall({
    toNumber: "+12025550102", agentId: "agent_delegate",
    metadata: { parent_call_id: "call_primary", delegation_depth: 1 },
    dynamicVariables: { call_role: "delegate", voice_task: "Ask about opening hours" },
    beginMessage: "Hello, I'm an automated assistant asking about opening hours.",
    idempotencyKey: "action_123",
  }), { callId: "call_real_123" });
  assert.equal(request.mock.callCount(), 1);
});

test("real call helper refuses mock mode and invalid destinations without provider requests", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  config.mockRetell = true;
  await assert.rejects(createPhoneCall({ toNumber: "+12025550102" }), /MOCK_RETELL=true/);
  await assert.rejects(getPhoneCall("call_123"), /MOCK_RETELL=true/);
  config.mockRetell = false;
  await assert.rejects(createPhoneCall({ toNumber: "555-0102" }), /E\.164/);
  assert.equal(request.mock.callCount(), 0);
});

test("provider failure or missing call ID never becomes a fabricated success", async () => {
  mock.method(globalThis, "fetch", async () => new Response("private telephone and secret", { status: 403 }));
  await assert.rejects(createPhoneCall({ toNumber: "+12025550102" }), (error: unknown) => {
    assert.match((error as Error).message, /403/);
    assert.doesNotMatch((error as Error).message, /private|telephone|secret/);
    return true;
  });
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => Response.json({ call_status: "registered" }));
  await assert.rejects(createPhoneCall({ toNumber: "+12025550102" }), /did not return a call ID/);
});

test("status lookup returns actual summary and transcript, omitting provider access tokens", async () => {
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(String(input), "https://api.retellai.com/v2/get-call/call_123");
    return Response.json({
      call_id: "call_123", call_status: "ended", transcript: "Contact: We close at six.", access_token: "private-token",
      metadata: { voice_action_id: "action_123" },
      call_analysis: { call_summary: "Contact confirmed closing time.", call_successful: true, private_field: "omit" },
    });
  });
  const result = await getPhoneCall("call_123");
  assert.equal(result.call_status, "ended");
  assert.match(result.transcript!, /close at six/);
  assert.equal(result.call_analysis?.call_summary, "Contact confirmed closing time.");
  assert.equal("access_token" in result, false);
  assert.equal("private_field" in result.call_analysis!, false);
});

test("real webhook verification checks raw body, signature, and freshness", async () => {
  const body = '{ "event": "call_ended" }';
  const signed = (timestamp: number) => `v=${timestamp},d=${createHmac("sha256", "test-retell-secret").update(body + timestamp).digest("hex")}`;
  const signature = signed(Date.now());
  assert.equal(await verifyWebhook(body, signature), true);
  assert.equal(await verifyWebhook(JSON.stringify(JSON.parse(body)), signature), false);
  assert.equal(await verifyWebhook(body, null), false);
  assert.equal(await verifyWebhook(body, "invalid"), false);
  assert.equal(await verifyWebhook(body, signed(Date.now() - 10 * 60_000)), false);
  delete process.env.RETELL_API_KEY;
  assert.equal(await verifyWebhook(body, signature), false);
});

test("dedicated signing key takes precedence and real callback verification never bypasses mock mode", async () => {
  const body = '{"event":"transcript_updated"}';
  const timestamp = Date.now();
  const signed = (key: string) => `v=${timestamp},d=${createHmac("sha256", key).update(body + timestamp).digest("hex")}`;
  process.env.RETELL_WEBHOOK_KEY = "test-webhook-secret";
  config.mockRetell = true;
  assert.equal(await verifyRetellSignature(body, signed("test-webhook-secret")), true);
  assert.equal(await verifyRetellSignature(body, signed("test-retell-secret")), false);
  assert.equal(await verifyRetellSignature(body, null), false);
  delete process.env.RETELL_WEBHOOK_KEY;
  assert.equal(await verifyRetellSignature(body, signed("test-retell-secret")), true);
});

test("ordinary explicitly mocked calls and fake-webhook workflow remain available", async () => {
  config.mockRetell = true;
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  const client: Client = {
    id: "client_test", name: "Test Client", phone: "+12025550102", risk_tier: "green", lives_alone: false,
    uses_powered_equipment: false, emergency_contact_name: "Contact", emergency_contact_phone: "+12025550103", usual_pickup_time: null,
  };
  assert.match((await placeCall({ client, checkId: "check_test", target: "client" })).callId, /^mock_/);
  assert.equal(await verifyWebhook("{}", null), true);
  assert.equal(request.mock.callCount(), 0);
});

test("configuration merges tools idempotently and preserves original prompt and unrelated defaults", () => {
  const original = {
    general_prompt: "Keep this original instruction.",
    general_tools: [{ type: "end_call", name: "end_call" }, { name: "research_web", url: "https://old.example.com" }],
    default_dynamic_variables: { agency_name: "Example Agency", call_role: "delegate" },
  };
  const tools = [{ type: "custom", name: "research_web", url: "https://voice.example.com/api/retell/tools" }];
  const once = buildLlmUpdate(original, tools);
  const twice = buildLlmUpdate(once, tools);
  assert.deepEqual(once, twice);
  assert.equal(once.general_tools.length, 2);
  assert.deepEqual(once.general_tools[0], original.general_tools[0]);
  assert.ok(once.general_prompt.startsWith(original.general_prompt));
  assert.equal(once.default_dynamic_variables.agency_name, "Example Agency");
  assert.equal(once.default_dynamic_variables.call_role, "primary");
  assert.equal(once.default_dynamic_variables.voice_task, "No delegated task");
});

test("configuration dry-run reads current engine version and sends no mutation", async () => {
  const methods: string[] = [];
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    if (String(input).endsWith("/get-agent/agent_test")) {
      return Response.json({ response_engine: { type: "retell-llm", llm_id: "llm_test", version: 3 }, is_published: false });
    }
    assert.equal(String(input), "https://api.retellai.com/get-retell-llm/llm_test?version=3");
    return Response.json({ general_prompt: "Existing instruction", general_tools: [{ type: "end_call", name: "end_call" }] });
  });
  const result = await configureVoiceAgent();
  assert.equal(result.mode, "dry-run");
  assert.equal(result.changed, true);
  assert.equal(result.preservedTools, 1);
  assert.equal(result.webhookConfigured, false);
  assert.deepEqual(methods, ["GET", "GET"]);
});

test("configuration refuses custom LLMs and published agents before any mutation", async () => {
  const methods: string[] = [];
  mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    return Response.json({ response_engine: { type: "custom-llm", llm_websocket_url: "wss://example.com" } });
  });
  await assert.rejects(configureVoiceAgent({ apply: true }), /custom LLM or conversation flow/);
  assert.deepEqual(methods, ["GET"]);
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "GET");
    return String(input).includes("get-agent")
      ? Response.json({ response_engine: { type: "retell-llm", llm_id: "llm_test", version: 1 }, is_published: true })
      : Response.json({ general_tools: [], general_prompt: "Existing instruction", is_published: true });
  });
  await assert.rejects(configureVoiceAgent({ apply: true }), /published/);
});

test("configuration applies only managed fields to the exact unchanged draft version", async () => {
  const methods: string[] = [];
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    const url = String(input);
    if (url.includes("get-agent")) return Response.json({
      version: 7, last_modification_timestamp: 456, webhook_events: ["transcript_updated"],
      response_engine: { type: "retell-llm", llm_id: "llm_test", version: 2 },
    });
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      if (url.includes("update-retell-llm")) {
        assert.equal(url, "https://api.retellai.com/update-retell-llm/llm_test?version=2");
        assert.deepEqual(Object.keys(body).sort(), ["default_dynamic_variables", "general_prompt", "general_tools"]);
      } else {
        assert.equal(url, "https://api.retellai.com/update-agent/agent_test?version=7");
        assert.deepEqual(body, {
          webhook_url: "https://voice.example.com/api/retell/webhook",
          webhook_events: ["transcript_updated", "call_ended", "call_analyzed"],
        });
      }
      return Response.json({});
    }
    return Response.json({ general_tools: [{ name: "end_call", type: "end_call" }], general_prompt: "Original", last_modification_timestamp: 123 });
  });
  const result = await configureVoiceAgent({ apply: true });
  assert.equal(result.mode, "apply");
  assert.equal(result.webhookConfigured, true);
  assert.deepEqual(methods, ["GET", "GET", "GET", "GET", "PATCH", "PATCH"]);
});

test("configuration resolves optional engine version and supports a separate delegate agent", async () => {
  const urls: string[] = [];
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("get-agent")) {
      assert.ok(url.includes("agent_delegate"));
      return Response.json({ version: 1, response_engine: { type: "retell-llm", llm_id: "llm_test", version: null } });
    }
    if (init?.method === "PATCH") return Response.json({});
    return Response.json({ version: 9, general_tools: [], general_prompt: "Original" });
  });
  delete process.env.RETELL_AGENT_ID;
  await configureVoiceAgent({ apply: true, agentId: "agent_delegate" });
  assert.ok(urls.includes("https://api.retellai.com/get-retell-llm/llm_test"));
  assert.ok(urls.includes("https://api.retellai.com/get-retell-llm/llm_test?version=9"));
  assert.ok(urls.includes("https://api.retellai.com/update-retell-llm/llm_test?version=9"));
});

test("configuration rejects missing credentials and private HTTP webhook URLs", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  delete process.env.RETELL_API_KEY;
  await assert.rejects(configureVoiceAgent({ apply: true }), /Missing configuration: RETELL_API_KEY/);
  for (const value of ["http://example.com", "https://localhost", "https://10.0.0.1", "https://user:secret@example.com"]) {
    assert.throws(() => validatePublicUrl(value), /public HTTPS/);
  }
  assert.equal(request.mock.callCount(), 0);
});

const testClient: Client = {
  id: "client_test", name: "Margaret Ellis", phone: "+12025550102", risk_tier: "red", lives_alone: true,
  uses_powered_equipment: false, emergency_contact_name: "Dana Ellis", emergency_contact_phone: "+12025550103", usual_pickup_time: null,
};

test("check-in mode chooses dedicated agents and sends the exact official alert and target variables", async () => {
  process.env.RETELL_DAILY_AGENT_ID = "agent_daily";
  process.env.RETELL_CRISIS_AGENT_ID = "agent_crisis";
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ call_id: `call_${bodies.length}` });
  });
  const base = { id: "event_test", started_at: "2026-10-17T20:00:00Z" };
  await placeCall({ client: testClient, checkId: "check_test", target: "client", event: { ...base, type: "daily", alert_text: null } });
  const alert = "  Official message. Keep this exact wording.\nSecond line.  ";
  await placeCall({ client: testClient, checkId: "check_test", target: "emergency_contact", event: { ...base, type: "heat_wave", alert_text: alert } });
  assert.equal(bodies[0].override_agent_id, "agent_daily");
  assert.equal(bodies[1].override_agent_id, "agent_crisis");
  assert.equal(bodies[1].to_number, testClient.emergency_contact_phone);
  assert.deepEqual(bodies[1].retell_llm_dynamic_variables, {
    name: "Margaret Ellis", agency_name: config.agencyName, mode: "crisis", alert_text: alert,
    call_target: "emergency_contact", contact_name: "Dana Ellis", language: "en",
  });
  assert.deepEqual(bodies[0].metadata, { check_id: "check_test", target: "client", mode: "daily" });
});

test("missing crisis alert blocks dialing and language agents fall back only to the dedicated English mode", async () => {
  const bodies: Record<string, unknown>[] = [];
  const request = mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ call_id: "call_language" });
  });
  await assert.rejects(placeCall({ client: testClient, checkId: "check_test", target: "client" }), /official alert/);
  assert.equal(request.mock.callCount(), 0);
  const input = { client: { ...testClient, language: "ko" }, checkId: "check_test", target: "client" as const, event: { id: "event_test", type: "daily", alert_text: null, started_at: "2026-10-17T20:00:00Z" } };
  await assert.rejects(placeCall(input), /RETELL_DAILY_AGENT_ID/);
  assert.equal(request.mock.callCount(), 0);
  process.env.RETELL_DAILY_AGENT_ID = "agent_daily";
  await placeCall(input);
  process.env.RETELL_DAILY_KO_AGENT_ID = "agent_daily_ko";
  await placeCall(input);
  assert.deepEqual(bodies.map((body) => body.override_agent_id), ["agent_daily", "agent_daily_ko"]);
});

test("Heartbeat readiness and event start reject generic-only configuration before any network or database action", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  const readiness = getHeartbeatCallingReadiness();
  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.missing, ["RETELL_DAILY_AGENT_ID", "RETELL_CRISIS_AGENT_ID"]);
  const response = await startHeartbeatEvent(new Request("https://heartbeat.example.com/api/events/start", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "daily" }),
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /dedicated agent/);
  assert.equal(request.mock.callCount(), 0);
  process.env.RETELL_DAILY_AGENT_ID = "private_daily_agent";
  assert.equal(getHeartbeatCallingReadiness("daily").configured, true);
  assert.equal(getHeartbeatCallingReadiness("crisis").configured, false);
  assert.ok(!JSON.stringify(getHeartbeatCallingReadiness()).includes("private_daily_agent"));
});

test("live Heartbeat cannot reuse a generic or another mode agent under a dedicated setting", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  const input = { client: testClient, checkId: "check_test", target: "client" as const, event: { id: "event_test", type: "daily", alert_text: null, started_at: "2026-10-17T20:00:00Z" } };
  process.env.RETELL_DAILY_AGENT_ID = process.env.RETELL_AGENT_ID;
  await assert.rejects(placeCall(input), /separate dedicated/);
  assert.equal(getHeartbeatCallingReadiness("daily").configured, false);
  process.env.RETELL_DAILY_AGENT_ID = "agent_shared";
  process.env.RETELL_CRISIS_AGENT_ID = "agent_shared";
  await assert.rejects(placeCall(input), /separate dedicated/);
  assert.equal(getHeartbeatCallingReadiness().invalid.length, 2);
  assert.equal(request.mock.callCount(), 0);
});

test("private teammate seed requires consent and preserves fictional display identities", () => {
  const local = { clients: [{ name: "Private Teammate", phone: "+12025550101", consent: true, language: "ko", emergency_contact: { name: "Private Contact", phone: "+12025550102", consent: true } }] };
  const clients = buildSeedClients(local);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].phone, "+12025550101");
  assert.equal(clients[0].name, "Margaret Ellis");
  assert.equal(clients[0].emergency_contact_name, "Dana Ellis");
  assert.equal(clients[0].language, "ko");
  assert.ok(!JSON.stringify(clients).includes("Private Teammate"));
  assert.throws(() => buildSeedClients({ clients: [{ ...local.clients[0], consent: false }] }), /consent:true/);
  assert.throws(() => buildSeedClients({ clients: [{ ...local.clients[0], phone: "911" }] }), /E.164/);
  assert.throws(() => buildSeedClients({ clients: [{ ...local.clients[0], emergency_contact: { ...local.clients[0].emergency_contact, consent: false } }] }), /consent:true/);
  assert.equal(buildSeedClients().length, 10);
  assert.ok(buildSeedClients().every((client) => client.phone.startsWith("+1555")));
});

test("simulated webhook uses the current call ID, user turns, and real contact confirmation fields", () => {
  const check = { id: "check_test", last_call_id: "mock_current", client: testClient };
  const payload = buildFakeWebhook(check, "ok", "emergency_contact", "crisis");
  assert.equal(payload.call.call_id, "mock_current");
  assert.equal(payload.call.call_analysis?.custom_analysis_data?.contact_confirms_ok, true);
  assert.ok(payload.call.call_analysis?.call_summary?.includes("Dana Ellis"));
  assert.ok(payload.call.transcript_object?.some((turn) => turn.role === "user" && turn.content.includes("Margaret Ellis")));
  assert.equal("mock_outcome" in payload.call.metadata!, false);
  assert.throws(() => buildFakeWebhook({ ...check, last_call_id: null }, "ok", "client", "daily"), /no active call/);
  const followUp = buildFakeWebhook(check, "follow_up", "client", "daily");
  assert.equal(followUp.call.call_analysis?.custom_analysis_data?.client_status, "needs_help");
  assert.ok(String(followUp.call.call_analysis?.custom_analysis_data?.request).includes("groceries"));
  const missed = buildFakeWebhook(check, "no_answer", "client", "daily");
  assert.equal(missed.call.call_analysis?.in_voicemail, true);
  assert.deepEqual(missed.call.transcript_object, []);
});

test("daily simulated answers contain identified patient evidence for every post-op field", () => {
  const check = { id: "check_test", last_call_id: "mock_daily", client: { name: "Margaret Ellis", emergency_contact_name: "Dana Ellis" } };
  for (const outcome of ["ok", "follow_up", "needs_ride"] as const) {
    const payload = buildFakeWebhook(check, outcome, "client", "daily");
    const assessment = buildPostOpAssessment(payload.call, { mode: "daily", target: "client", patientName: "Margaret Ellis" })!;
    assert.equal(assessment.patient_confirmed, true);
    assert.equal(assessment.answers.pain.value, 2);
    assert.ok(Object.values(assessment.answers).every((answer) => answer.status === "reported" && !!answer.quote));
    assert.equal(assessment.suggested_next_step.status, "proposed");
    assert.match(payload.call.call_analysis?.call_summary ?? "", /^SIMULATED:/);
  }
  assert.equal(buildFakeWebhook(check, "ok", "client", "daily").call.call_analysis?.custom_analysis_data?.needs_ride_quote, "I am okay. I can leave on my own.");
  assert.equal(buildFakeWebhook(check, "needs_ride", "client", "daily").call.call_analysis?.custom_analysis_data?.needs_ride_quote, "I need a ride to leave.");
});

test("interrupted and nonpatient simulated calls never manufacture questionnaire or mobility answers", () => {
  const check = { id: "check_test", last_call_id: "mock_daily", client: { name: "Margaret Ellis", emergency_contact_name: "Dana Ellis" } };
  for (const outcome of ["needs_human", "unclear"] as const) {
    const payload = buildFakeWebhook(check, outcome, "client", "daily");
    const assessment = buildPostOpAssessment(payload.call, { mode: "daily", target: "client", patientName: "Margaret Ellis" })!;
    assert.ok(Object.values(assessment.answers).every((answer) => answer.status === "unknown"));
    assert.equal(payload.call.call_analysis?.custom_analysis_data?.needs_ride_quote, "");
  }
  for (const [target, mode] of [["emergency_contact", "daily"], ["client", "crisis"]] as const) {
    const payload = buildFakeWebhook(check, "ok", target, mode);
    assert.equal(payload.call.call_analysis?.custom_analysis_data?.postop_patient_confirmed, undefined);
  }
});

test("daily and crisis plans exclude custom research tools and allow their bounded scripts and handoff", () => {
  for (const mode of ["daily", "crisis"] as const) {
    const plan = heartbeatAgentPlan(mode, "en", "https://voice.example.com");
    assert.deepEqual(plan.llm.general_tools.map((tool) => tool.type), ["end_call"]);
    assert.equal(plan.agent.max_call_duration_ms, mode === "daily" ? 360_000 : 180_000);
    assert.equal(plan.agent.webhook_url, "https://voice.example.com/api/retell/webhook");
    assert.deepEqual(plan.agent.post_call_analysis_data.map((field) => field.name), ["client_status", "request", "needs_ride", "needs_ride_quote", "contact_confirms_ok", "situation_urgency", "situation_evidence_quote", "reported_distress", "distress_evidence_quote", ...(mode === "daily" ? POSTOP_ANALYSIS_FIELDS.map((field) => field.name) : [])]);
    assert.ok(plan.agent.webhook_events.includes("transcript_updated"));
    assert.ok(plan.agent.webhook_events.includes("call_analyzed"));
    const distressField = plan.agent.post_call_analysis_data.find((field) => field.name === "reported_distress");
    assert.match(distressField?.description ?? "", /not voice-tone/);
    assert.match(plan.llm.general_prompt, /automated/);
  }
  const crisis = heartbeatAgentPlan("crisis", "en", "https://voice.example.com");
  assert.match(crisis.llm.general_prompt, /WORD FOR WORD/);
  assert.ok(crisis.llm.general_prompt.includes("{{alert_text}}"));
  assert.equal(heartbeatAgentPlan("daily", "ko", "https://voice.example.com").envName, "RETELL_DAILY_KO_AGENT_ID");
  assert.ok(renderHeartbeatAgentDocs().includes(crisis.llm.general_prompt));
});

test("Heartbeat setup dry-run provisions nothing, and apply refuses missing credentials", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  delete process.env.RETELL_API_KEY;
  delete process.env.APP_URL;
  delete process.env.VOICE_PUBLIC_URL;
  const dry = await configureHeartbeatAgents();
  assert.equal(dry.mode, "dry-run");
  assert.ok("missing" in dry && dry.missing?.includes("RETELL_API_KEY"));
  await assert.rejects(configureHeartbeatAgents({ apply: true }), /Missing RETELL_API_KEY/);
  assert.equal(request.mock.callCount(), 0);
});

test("Heartbeat setup refuses reusing a generic or another mode's agent before mutations", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  process.env.RETELL_DAILY_AGENT_ID = process.env.RETELL_AGENT_ID;
  await assert.rejects(configureHeartbeatAgents({ apply: true }), /separate dedicated agent/);
  process.env.RETELL_DAILY_AGENT_ID = "agent_shared_mode";
  process.env.RETELL_CRISIS_AGENT_ID = "agent_shared_mode";
  await assert.rejects(configureHeartbeatAgents({ apply: true }), /separate dedicated agent/);
  assert.equal(request.mock.callCount(), 0);
});

test("Heartbeat dry-run tolerates local APP_URL and prioritizes its dedicated public URL", async () => {
  const request = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  process.env.APP_URL = "http://127.0.0.1:3000";
  delete process.env.VOICE_PUBLIC_URL;
  let result = await configureHeartbeatAgents();
  assert.equal(result.mode, "dry-run");
  assert.ok("missing" in result && result.missing?.includes("HEARTBEAT_PUBLIC_URL (public HTTPS)"));
  await assert.rejects(configureHeartbeatAgents({ apply: true }), /public HTTPS HEARTBEAT_PUBLIC_URL/);
  process.env.HEARTBEAT_PUBLIC_URL = "https://heartbeat.example.com";
  result = await configureHeartbeatAgents();
  assert.ok("missing" in result && !result.missing?.includes("HEARTBEAT_PUBLIC_URL (public HTTPS)"));
  assert.equal(request.mock.callCount(), 0);
});

test("fictional Harold Kim requests Korean by default while explicit private language choices win", () => {
  const clients = buildSeedClients();
  assert.equal(clients[1].name, "Harold Kim");
  assert.equal(clients[1].language, "ko");
  assert.ok(clients.filter((_, index) => index !== 1).every((client) => client.language === "en"));
  const person = { name: "Consenting Teammate", consent: true, emergency_contact: { name: "Consenting Contact", phone: "+12025550103", consent: true } };
  const explicit = buildSeedClients({ clients: [{ ...person, phone: "+12025550101" }, { ...person, phone: "+12025550102", language: "en" }] });
  assert.equal(explicit[0].language, "en");
  assert.equal(explicit[1].language, "en");
});

test("Korean check-in prompts disclose automation, hand off urgent reports, and preserve the original crisis alert", () => {
  for (const mode of ["daily", "crisis"] as const) {
    const plan = heartbeatAgentPlan(mode, "ko", "https://heartbeat.example.com");
    assert.equal(plan.agent.language, "ko-KR");
    assert.equal(plan.agent.max_call_duration_ms, mode === "daily" ? 360_000 : 180_000);
    assert.match(plan.llm.general_prompt, /자동 안부 확인/);
    assert.match(plan.llm.general_prompt, /가슴이 아파요/);
    assert.match(plan.llm.general_prompt, /숨을 못 쉬겠어요/);
    assert.match(plan.llm.general_prompt, /연결/);
  }
  assert.match(HEARTBEAT_PROMPTS.ko.daily, /수술/);
  assert.match(HEARTBEAT_PROMPTS.ko.crisis, /ORIGINAL LANGUAGE/);
  assert.match(HEARTBEAT_PROMPTS.ko.crisis, /나갈 수 없어요/);
  assert.ok(HEARTBEAT_PROMPTS.ko.crisis.includes("{{alert_text}}"));
  assert.match(renderHeartbeatAgentDocs(), /Korean prompts have not been verified in a real phone call/);
});
