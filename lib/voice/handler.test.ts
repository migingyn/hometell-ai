import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import Retell, { sign } from "retell-sdk";
import { dispatchVoiceTool } from "./dispatch";
import { handleVoiceTool } from "./handler";
import type { ResearchResult } from "./types";

const KEY = "test-only-retell-signing-key";
const AGENT = "agent_test_parent";
const DELEGATE_AGENT = "agent_test_delegate";
const ENV_KEYS = ["RETELL_API_KEY", "RETELL_AGENT_ID", "RETELL_DELEGATE_AGENT_ID", "MOCK_RETELL"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.RETELL_API_KEY = KEY;
  process.env.RETELL_AGENT_ID = AGENT;
  process.env.RETELL_DELEGATE_AGENT_ID = DELEGATE_AGENT;
  process.env.MOCK_RETELL = "false";
  globalThis.fetch = async () => { throw new Error("An integration boundary test must not use the network"); };
});
afterEach(() => {
  for (const name of ENV_KEYS) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  globalThis.fetch = originalFetch;
});

const finding = (): ResearchResult => ({
  status: "grounded", answer: "The official page has an update; current availability is unconfirmed.",
  sources: [{ title: "Official update", url: "https://example.org/update", retrievedAt: "2026-10-17T00:00:00.000Z" }],
  retrievedAt: "2026-10-17T00:00:00.000Z", limitations: ["Retrieval time does not establish live availability."],
});

function payload(extra: Record<string, unknown> = {}) {
  return { name: "research_web", args: { query: "Find the current official public update" }, call: { call_id: "call_parent_test", agent_id: AGENT }, ...extra };
}

async function request(body: unknown = payload(), headers: HeadersInit = {}, signal?: AbortSignal) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://voice.example.org/api/retell/tools", {
    method: "POST", body: raw, signal,
    headers: { "Content-Type": "application/json", "x-retell-signature": await sign(raw, KEY), ...Object.fromEntries(new Headers(headers)) },
  });
}

test("accepts an authentic SDK signature over the exact raw body and forwards parent context", async () => {
  const caller = new AbortController();
  const req = await request(payload(), {}, caller.signal);
  const raw = await req.clone().text();
  assert.equal(await Retell.verify(raw, KEY, req.headers.get("x-retell-signature")!), true);
  let calls = 0;
  const response = await handleVoiceTool(req, async (name, args, context, signal) => {
    calls++;
    assert.equal(name, "research_web");
    assert.deepEqual(args, { query: "Find the current official public update" });
    assert.deepEqual(context, { callId: "call_parent_test", delegationDepth: 0 });
    assert.equal(signal, req.signal);
    return finding();
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.status, "grounded");
  assert.equal(body.contentIsUntrusted, true);
  assert.match(body.limitations[0], /does not establish live/);
});

test("routes a configured delegated call with its own call ID and delegation depth", async () => {
  const req = await request(payload({ call: { call_id: "call_child_test", agent_id: DELEGATE_AGENT, metadata: { parent_call_id: "call_parent_test", delegation_depth: 1 } } }));
  const response = await handleVoiceTool(req, async (_name, _args, context) => {
    assert.deepEqual(context, { callId: "call_child_test", delegationDepth: 1 });
    return finding();
  });
  assert.equal(response.status, 200);
});

test("a dedicated delegate cannot regain parent privileges by omitting depth or setting it to zero", async () => {
  for (const metadata of [undefined, { delegation_depth: 0 }]) {
    const req = await request(payload({ call: { call_id: "call_child_test", agent_id: DELEGATE_AGENT, ...(metadata ? { metadata } : {}) } }));
    const response = await handleVoiceTool(req, async (_name, _args, child) => {
      assert.deepEqual(child, { callId: "call_child_test", delegationDepth: 1 });
      return finding();
    });
    assert.equal(response.status, 200);
  }
});

test("signed invalid delegation depths are rejected before dispatch", async () => {
  let calls = 0;
  for (const depth of [-1, 1.5, 6, "1", "invalid", true, {}, []]) {
    const req = await request(payload({ call: { call_id: "call_child_test", agent_id: AGENT, metadata: { delegation_depth: depth } } }));
    const response = await handleVoiceTool(req, async () => { calls++; return finding(); });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Invalid delegation context/);
  }
  assert.equal(calls, 0);
});

test("a signed dedicated delegate cannot recursively research or start another telephone call", async () => {
  let spawned = 0;
  const research = await request(payload({
    name: "delegate_research", args: { task: "Check current public information", agentCount: 3 },
    call: { call_id: "call_child_test", agent_id: DELEGATE_AGENT },
  }));
  const researchResponse = await handleVoiceTool(research, (name, args, child, signal) => dispatchVoiceTool(name, args, child, signal, {
    delegate: async () => { spawned++; throw new Error("No agent may be launched"); },
  }));
  assert.equal(researchResponse.status, 200);
  assert.equal((await researchResponse.json()).status, "unavailable");
  assert.equal(spawned, 0);

  const call = await request(payload({
    name: "call_contact", args: { contactId: "frontdesk", purpose: "Ask about public hours", callerConfirmed: true },
    call: { call_id: "call_child_test", agent_id: DELEGATE_AGENT },
  }));
  const callResponse = await handleVoiceTool(call);
  assert.equal(callResponse.status, 200);
  assert.equal((await callResponse.json()).status, "unavailable");
});

test("missing, malformed, tampered, and expired signatures never reach dispatch", async () => {
  let calls = 0;
  const dispatch: typeof dispatchVoiceTool = async () => { calls++; return finding(); };
  const missing = await request();
  missing.headers.delete("x-retell-signature");
  assert.equal((await handleVoiceTool(missing, dispatch)).status, 401);
  const malformed = await request(payload(), { "x-retell-signature": "invalid-signature" });
  assert.equal((await handleVoiceTool(malformed, dispatch)).status, 401);

  const original = JSON.stringify(payload());
  const signature = await sign(original, KEY);
  const changed = new Request("https://voice.example.org/api/retell/tools", {
    method: "POST", body: original.replace("official", "tampered"), headers: { "x-retell-signature": signature },
  });
  assert.equal((await handleVoiceTool(changed, dispatch)).status, 401);

  // Mirrors the SDK's primary-source signing algorithm: HMAC-SHA256(secret, raw + timestamp).
  const timestamp = Date.now() - 6 * 60_000;
  const digest = createHmac("sha256", KEY).update(original + timestamp).digest("hex");
  const expired = await request(original, { "x-retell-signature": `v=${timestamp},d=${digest}` });
  assert.equal((await handleVoiceTool(expired, dispatch)).status, 401);
  assert.equal(calls, 0);
});

test("missing live configuration and mock mode fail closed before dispatch", async () => {
  let calls = 0;
  const dispatch: typeof dispatchVoiceTool = async () => { calls++; return finding(); };
  for (const missing of ["RETELL_API_KEY", "RETELL_AGENT_ID"] as const) {
    delete process.env[missing];
    const response = await handleVoiceTool(await request(), dispatch);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, "unavailable");
    process.env[missing] = missing === "RETELL_API_KEY" ? KEY : AGENT;
  }
  process.env.MOCK_RETELL = "true";
  assert.equal((await handleVoiceTool(await request(), dispatch)).status, 503);
  assert.equal(calls, 0);
});

test("a valid signature for an unconfigured agent is rejected", async () => {
  let calls = 0;
  const response = await handleVoiceTool(await request(payload({ call: { call_id: "call_other", agent_id: "agent_other" } })), async () => {
    calls++; return finding();
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("signed malformed JSON and unknown tool payloads are rejected before dispatch", async () => {
  let calls = 0;
  const dispatch: typeof dispatchVoiceTool = async () => { calls++; return finding(); };
  assert.equal((await handleVoiceTool(await request("{not-json"), dispatch)).status, 400);
  assert.equal((await handleVoiceTool(await request(payload({ name: "send_unapproved_message" })), dispatch)).status, 400);
  assert.equal((await handleVoiceTool(await request(payload({ call: { call_id: "", agent_id: AGENT } })), dispatch)).status, 400);
  assert.equal(calls, 0);
});

test("oversized body bytes and content-length fail closed", async () => {
  let calls = 0;
  const dispatch: typeof dispatchVoiceTool = async () => { calls++; return finding(); };
  const advertised = await request(payload(), { "content-length": "262145" });
  assert.equal((await handleVoiceTool(advertised, dispatch)).status, 413);
  const unicode = "😀".repeat(70_000);
  assert.ok(unicode.length < 262144);
  assert.ok(Buffer.byteLength(unicode, "utf8") > 262144);
  assert.equal((await handleVoiceTool(await request(unicode), dispatch)).status, 413);
  assert.equal(calls, 0);
});

test("signed invalid tool arguments return an honest unavailable result without a research request", async () => {
  let researchCalls = 0;
  const req = await request(payload({ args: { query: "ok", unexpected: true } }));
  const response = await handleVoiceTool(req, (name, args, context, signal) => dispatchVoiceTool(name, args, context, signal, {
    research: async () => { researchCalls++; return finding(); },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.match(body.message, /arguments are invalid/);
  assert.equal(researchCalls, 0);
});

test("upstream failures never echo private errors or imply a completed action", async () => {
  const response = await handleVoiceTool(await request(), async () => {
    throw new Error("private-key +15555551234 database-password");
  });
  const raw = await response.text();
  const body = JSON.parse(raw);
  assert.equal(response.status, 200);
  assert.equal(body.status, "unavailable");
  assert.match(body.message, /Do not claim it succeeded/);
  assert.doesNotMatch(raw, /private-key|15555551234|database-password/);
});

test("large signed tool results remain valid JSON within Retell's response boundary", async () => {
  const response = await handleVoiceTool(await request(), async () => ({
    ...finding(), answer: "A cited answer with quotes \" and emoji 😀. ".repeat(5_000),
    limitations: Array.from({ length: 20 }, () => "Keep this unknown and caveat. ".repeat(1_000)),
  }));
  const raw = await response.text();
  assert.equal(response.status, 200);
  assert.ok(raw.length <= 14_000);
  const body = JSON.parse(raw);
  assert.ok(body.status === "grounded" || body.status === "unavailable");
});
