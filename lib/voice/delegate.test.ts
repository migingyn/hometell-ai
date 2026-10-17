import assert from "node:assert/strict";
import { test } from "node:test";
import { delegateResearch } from "./delegate";
import type { ResearchResult } from "./types";

function grounded(answer = "The office opens at 9 AM.", url = "https://example.org/hours"): ResearchResult {
  return {
    status: "grounded",
    answer,
    sources: [{ title: "Official hours", url, retrievedAt: "2026-10-17T00:00:00.000Z" }],
    retrievedAt: "2026-10-17T00:00:00.000Z",
    limitations: [],
  };
}

test("starts exactly three independent workers concurrently and labels shared evidence", async () => {
  const requests: { query: string; focus?: string; signal?: AbortSignal }[] = [];
  const releases: (() => void)[] = [];
  const run = delegateResearch({ task: "  What are the office hours today?  " }, {
    research: async (request) => {
      requests.push(request);
      await new Promise<void>((resolve) => releases.push(resolve));
      return grounded();
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map((request) => request.focus)).size, 3);
  assert.equal(new Set(requests.map((request) => request.signal)).size, 1);
  assert.ok(requests.every((request) => request.query === "What are the office hours today?"));
  releases.forEach((release) => release());
  const result = await run;
  assert.equal(result.status, "completed");
  assert.equal(result.agents.length, 3);
  assert.equal(new Set(result.agents.map((agent) => agent.id)).size, 3);
  assert.equal(result.sources.length, 1);
  assert.match(result.summary, /not independent corroboration/);
  assert.ok(Date.parse(result.completedAt) >= Date.parse(result.startedAt));
});

test("supports exactly four or five workers and rejects invalid counts before any request", async () => {
  for (const count of [4, 5]) {
    let calls = 0;
    const result = await delegateResearch({ task: "Find current hours", agentCount: count }, {
      research: async () => { calls++; return grounded(); },
    });
    assert.equal(calls, count);
    assert.equal(result.agents.length, count);
  }
  for (const count of [0, 2, 6, 3.5, NaN, Infinity]) {
    let called = false;
    await assert.rejects(delegateResearch({ task: "Find current hours", agentCount: count }, {
      research: async () => { called = true; return grounded(); },
    }), /integer from 3 to 5/);
    assert.equal(called, false);
  }
});

test("preserves contradictory findings and unknowns while isolating secret-bearing failures", async () => {
  let calls = 0;
  const result = await delegateResearch({ task: "Find current hours" }, {
    research: async () => {
      calls++;
      if (calls === 1) return { ...grounded("The city page says 9 AM."), limitations: ["The page does not mention holidays."] };
      if (calls === 2) return grounded("The latest notice says opening is delayed until 11 AM.", "https://example.org/notice");
      throw new Error("provider failure API_KEY=private-secret");
    },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.sources.length, 2);
  assert.match(result.summary, /9 AM/);
  assert.match(result.summary, /11 AM/);
  assert.match(result.summary, /may disagree/);
  assert.deepEqual(result.agents[0].result.limitations, ["The page does not mention holidays."]);
  assert.equal(result.agents[2].result.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private-secret|API_KEY/);
});

test("one shared deadline returns partial findings and aborts outstanding workers", async () => {
  let calls = 0;
  const workerSignals: AbortSignal[] = [];
  const start = Date.now();
  const result = await delegateResearch({ task: "Check current status" }, {
    timeoutMs: 25,
    research: async ({ signal }) => {
      calls++;
      workerSignals.push(signal!);
      if (calls === 1) return grounded();
      // Deliberately ignore the signal: the aggregate must still obey its hard deadline.
      return new Promise<ResearchResult>(() => undefined);
    },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.agents.filter((agent) => agent.result.status === "unavailable").length, 2);
  assert.ok(workerSignals.every((signal) => signal.aborted));
  assert.ok(Date.now() - start < 1_000);
  assert.match(result.agents[2].result.limitations[0], /shared research deadline/);
});

test("caller abort cancels active workers without exposing the abort reason", async () => {
  const controller = new AbortController();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const run = delegateResearch({ task: "Check current status", signal: controller.signal }, {
    research: async (request) => {
      calls++;
      signal = request.signal;
      return new Promise<ResearchResult>(() => undefined);
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new Error("caller-private-secret"));
  const result = await run;
  assert.equal(calls, 3);
  assert.equal(signal?.aborted, true);
  assert.equal(result.status, "unavailable");
  assert.ok(result.agents.every((agent) => /cancelled/.test(agent.result.limitations[0])));
  assert.doesNotMatch(JSON.stringify(result), /caller-private-secret/);
});

test("an already aborted request makes no provider calls", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await delegateResearch({ task: "Check current status", signal: controller.signal }, {
    research: async () => { calls++; return grounded(); },
  });
  assert.equal(calls, 0);
  assert.equal(result.agents.length, 3);
  assert.equal(result.status, "unavailable");
});

test("a worker rejection after the aggregate deadline stays handled", async () => {
  const rejections: ((reason: Error) => void)[] = [];
  const result = await delegateResearch({ task: "Check current status" }, {
    timeoutMs: 5,
    research: async () => new Promise<ResearchResult>((_resolve, reject) => rejections.push(reject)),
  });
  assert.equal(result.status, "unavailable");
  rejections.forEach((reject) => reject(new Error("late-private-secret")));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.doesNotMatch(JSON.stringify(result), /late-private-secret/);
});

test("unverified results and invalid source URLs cannot become verified aggregate evidence", async () => {
  let calls = 0;
  const result = await delegateResearch({ task: "Check current status" }, {
    research: async () => {
      calls++;
      if (calls === 1) return grounded("Unsupported claim", "javascript:alert(1)");
      if (calls === 2) return grounded("Unsupported claim", "https://name:password@example.org/hours");
      return { ...grounded("Unconfirmed claim"), status: "unverified" };
    },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.sources.length, 0);
  assert.ok(result.agents.every((agent) => agent.result.status === "unverified"));
  assert.doesNotMatch(result.summary, /Unsupported claim|Unconfirmed claim/);
});

test("deduplicates equivalent tracking URLs without dropping workers or their disagreements", async () => {
  let calls = 0;
  const result = await delegateResearch({ task: "Check current status" }, {
    research: async () => {
      calls++;
      return grounded(`Finding ${calls}`, `https://example.org/hours?utm_source=agent${calls}#section${calls}`);
    },
  });
  assert.equal(result.sources.length, 1);
  assert.equal(result.agents.length, 3);
  assert.ok(result.agents.every((agent) => agent.result.sources.length === 1));
  assert.match(result.summary, /Finding 1/);
  assert.match(result.summary, /Finding 2/);
  assert.match(result.summary, /Finding 3/);
});

test("rejects empty or oversized tasks before requesting research", async () => {
  for (const task of ["", "   ", "x".repeat(1_201)]) {
    await assert.rejects(delegateResearch({ task }, {
      research: async () => { throw new Error("should not be called"); },
    }), /1–1200 characters/);
  }
});
