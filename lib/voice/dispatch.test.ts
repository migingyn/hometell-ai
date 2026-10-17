import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedToolJson, dispatchVoiceTool } from "./dispatch";
import type { DelegationResult, ResearchResult } from "./types";

const context = { callId: "call_parent_test", delegationDepth: 0 };
const date = "2026-10-17T00:00:00.000Z";
const actionId = "c8495488-8426-4b24-b6a2-0ad0a9946627";
const finding = (): ResearchResult => ({
  status: "grounded", answer: "An official source reports a public update.",
  sources: [{ title: "Official update", url: "https://example.org/update", retrievedAt: date }],
  retrievedAt: date, limitations: ["Current availability remains unknown."],
});
function delegation(count: number): DelegationResult {
  return {
    runId: "test-run", status: "completed", sources: finding().sources,
    summary: "Source-supported findings may disagree.", startedAt: date, completedAt: date,
    agents: Array.from({ length: count }, (_, i) => ({ id: `worker-${i}`, role: `Role ${i}`, result: finding() })),
  };
}

test("public research receives only the validated public query and cancellation signal", async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const output = await dispatchVoiceTool("research_web", { query: "  Find the current official alert  " }, context, signal, {
    research: async (input) => {
      calls++;
      assert.deepEqual(input, { query: "Find the current official alert", signal });
      return finding();
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(output, finding());
});

test("delegation uses default three workers and accepts an explicit maximum of five", async () => {
  for (const agentCount of [undefined, 5]) {
    let calls = 0;
    const signal = new AbortController().signal;
    const output = await dispatchVoiceTool("delegate_research", {
      task: "Find public information from independent angles", ...(agentCount === undefined ? {} : { agentCount }),
    }, context, signal, {
      delegate: async (input) => {
        calls++;
        assert.equal(input.agentCount, agentCount ?? 3);
        assert.equal(input.signal, signal);
        assert.equal(input.task, "Find public information from independent angles");
        return delegation(input.agentCount ?? 3);
      },
    });
    assert.equal(calls, 1);
    assert.ok("agents" in output!);
    assert.equal(output.agents.length, agentCount ?? 3);
    assert.deepEqual(output.agents[0].limitations, ["Current availability remains unknown."]);
    assert.deepEqual(output.agents[0].sourceUrls, ["https://example.org/update"]);
  }
});

test("delegation rejects excess, fractional, and too-few workers before launching", async () => {
  let calls = 0;
  for (const agentCount of [2, 6, 100, 3.5]) {
    await assert.rejects(dispatchVoiceTool("delegate_research", { task: "Find public information", agentCount }, context, undefined, {
      delegate: async () => { calls++; return delegation(3); },
    }));
  }
  assert.equal(calls, 0);
});

test("a delegated call cannot recursively spawn more research agents", async () => {
  let calls = 0;
  await assert.rejects(dispatchVoiceTool("delegate_research", { task: "Find public information", agentCount: 3 }, {
    callId: "call_child_test", delegationDepth: 1,
  }, undefined, { delegate: async () => { calls++; return delegation(3); } }), /cannot spawn more agents/);
  assert.equal(calls, 0);
});

test("the contact directory returns names and IDs while withholding telephone numbers", async () => {
  const output = await dispatchVoiceTool("list_contacts", {}, context, undefined, {
    contacts: () => [{ id: "frontdesk", name: "Front desk", phone: "+15555550123", description: "Organization's approved public desk" }],
  });
  assert.deepEqual(output, { contacts: [{ id: "frontdesk", name: "Front desk", description: "Organization's approved public desk" }] });
  assert.doesNotMatch(JSON.stringify(output), /15555550123|phone/);
});

test("the confirmed outbound action routes to the action service with parent ownership", async () => {
  let calls = 0;
  const input = { contactId: "frontdesk", purpose: "  Ask about public opening hours  ", callerConfirmed: true };
  const output = await dispatchVoiceTool("call_contact", input, context, undefined, {
    call: async (received, parent) => {
      calls++;
      assert.deepEqual(received, { contactId: "frontdesk", purpose: "Ask about public opening hours", callerConfirmed: true });
      assert.deepEqual(parent, context);
      return { actionId, status: "queued", message: "The provider accepted the request; no answer has been confirmed." };
    },
  });
  assert.equal(calls, 1);
  assert.ok("status" in output!);
  assert.equal(output.status, "queued");
  assert.match(JSON.stringify(output), /no answer has been confirmed/);
});

test("outbound results route only the validated action ID and current caller context", async () => {
  let calls = 0;
  const output = await dispatchVoiceTool("get_call_result", { actionId }, context, undefined, {
    result: async (received, parent) => {
      calls++;
      assert.equal(received, actionId);
      assert.deepEqual(parent, context);
      return { actionId, status: "queued", result: null, message: "No recipient response has been confirmed." };
    },
  });
  assert.equal(calls, 1);
  assert.ok("status" in output!);
  assert.equal(output.status, "queued");
});

test("malformed or extra arguments fail before any research or side effect", async () => {
  let calls = 0;
  const deps: NonNullable<Parameters<typeof dispatchVoiceTool>[4]> = {
    research: async () => { calls++; return finding(); },
    contacts: () => { calls++; return []; },
    call: async () => { calls++; return { actionId, status: "queued", message: "No answer yet" }; },
    result: async () => { calls++; return { actionId, status: "queued", result: null, message: "No answer yet" }; },
  };
  const cases = [
    ["research_web", { query: "x" }],
    ["research_web", { query: "x".repeat(1_201) }],
    ["research_web", { query: "Valid public question", privateTranscript: "must not be sent" }],
    ["list_contacts", { phone: "+15555550123" }],
    ["call_contact", { contactId: "frontdesk", purpose: "Ask about hours", callerConfirmed: "yes" }],
    ["call_contact", { contactId: "frontdesk", purpose: "Ask about hours" }],
    ["call_contact", { contactId: "frontdesk", purpose: "Ask about hours", callerConfirmed: true, phone: "+15555550123" }],
    ["get_call_result", { actionId: "not-a-uuid" }],
  ] as const;
  for (const [name, args] of cases) await assert.rejects(dispatchVoiceTool(name, args, context, undefined, deps));
  assert.equal(calls, 0);
});

test("bounded tool JSON preserves valid JSON and flags returned evidence as untrusted", () => {
  const raw = boundedToolJson({ ...finding(), answer: "A claim with escaped quotes \" and emoji 😀. ".repeat(10_000) });
  assert.ok(raw.length <= 14_000);
  const output = JSON.parse(raw);
  assert.equal(output.status, "grounded");
  assert.equal(output.contentIsUntrusted, true);
  assert.deepEqual(output.sources, finding().sources);
});

test("compaction preserves full citation URLs and per-agent source URLs", () => {
  const url = `https://example.org/official-source?identifier=${"a".repeat(4_000)}`;
  const raw = boundedToolJson({
    ...finding(), answer: "A long answer with quotes \". ".repeat(3_000),
    sources: [{ ...finding().sources[0], url }],
    agents: [{ role: "Primary source check", sourceUrls: [url] }],
  });
  assert.ok(raw.length <= 14_000);
  const output = JSON.parse(raw);
  assert.equal(output.status, "grounded");
  assert.equal(output.sources[0].url, url);
  assert.equal(output.agents[0].sourceUrls[0], url);
});

test("an oversized citation URL yields unavailable instead of a fabricated shortened URL", () => {
  const url = `https://example.org/official-source?identifier=${"a".repeat(15_000)}`;
  for (const citations of [{ sources: [{ ...finding().sources[0], url }] }, { agents: [{ sourceUrls: [url] }] }]) {
    const raw = boundedToolJson({ status: "grounded", ...citations });
    assert.ok(raw.length <= 14_000);
    const output = JSON.parse(raw);
    assert.equal(output.status, "unavailable");
    assert.match(output.message, /response limit/);
    assert.doesNotMatch(raw, /example\.org/);
  }
});

test("unrepresentable response volume becomes unavailable instead of truncated invalid JSON", () => {
  const raw = boundedToolJson({ status: "grounded", sources: Array.from({ length: 1_000 }, () => ({ url: "https://example.org/source", title: "Source" })) });
  assert.ok(raw.length <= 14_000);
  const output = JSON.parse(raw);
  assert.equal(output.status, "unavailable");
  assert.match(output.message, /response limit/);
});
