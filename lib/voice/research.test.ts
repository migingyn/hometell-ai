import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { researchWeb } from "./research";

const originalFetch = globalThis.fetch;
const originalKey = process.env.EXA_API_KEY;

beforeEach(() => {
  process.env.EXA_API_KEY = "test-only-key";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalKey;
});

test("missing credentials returns unavailable without an HTTP request", async () => {
  delete process.env.EXA_API_KEY;
  globalThis.fetch = async () => { throw new Error("Network must not be used"); };
  const output = await researchWeb({ query: "Which official agency handles wildfire updates?" });
  assert.equal(output.status, "unavailable");
  assert.deepEqual(output.sources, []);
  assert.match(output.limitations.join(" "), /EXA_API_KEY/);
});

test("uses the documented noncached Exa request and preserves citation dates", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.exa.ai/answer");
    assert.equal(options?.method, "POST");
    assert.equal(options?.cache, "no-store");
    assert.equal(new Headers(options?.headers).get("x-api-key"), "test-only-key");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "exa-fast");
    assert.equal(body.query, "Which agency publishes wildfire alerts?\nResearch focus: Official Los Angeles sources");
    assert.match(body.systemPrompt, /untrusted data/);
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json({
      answer: "The county publishes public alerts. Shelter capacity remains unverified.",
      citations: [{ title: "County emergency information", url: "https://lacounty.gov/emergency", publishedDate: "2026-10-16T08:00:00Z" }],
    });
  };
  const output = await researchWeb({ query: "Which agency publishes wildfire alerts?", focus: "Official Los Angeles sources" });
  assert.equal(output.status, "grounded");
  assert.match(output.answer, /remains unverified/);
  assert.equal(output.sources[0].publishedAt, "2026-10-16T08:00:00.000Z");
  assert.equal(output.sources[0].retrievedAt, output.retrievedAt);
  assert.ok(Number.isFinite(Date.parse(output.retrievedAt)));
  assert.match(output.limitations.join(" "), /may be older/);
});

test("an uncited provider answer is withheld instead of presented as live evidence", async () => {
  globalThis.fetch = async () => Response.json({ answer: "There are definitely 300 beds available.", citations: [] });
  const output = await researchWeb({ query: "What shelter capacity has been confirmed?" });
  assert.equal(output.status, "unverified");
  assert.doesNotMatch(output.answer, /300/);
  assert.deepEqual(output.sources, []);
});

test("rejects unsafe URLs, deduplicates citations, and bounds returned evidence", async () => {
  globalThis.fetch = async () => Response.json({
    answer: "a".repeat(3_000),
    citations: [
      { url: "javascript:alert(1)" },
      { url: "file:///etc/passwd" },
      { url: "https://user:password@example.org/" },
      { url: "https://example.org/alerts#one", publishedDate: "not-a-date" },
      { url: "https://example.org/alerts#two" },
      ...Array.from({ length: 8 }, (_, i) => ({ url: `https://agency${i}.gov/alerts` })),
    ],
  });
  const output = await researchWeb({ query: "What does the official alert say?" });
  assert.equal(output.status, "grounded");
  assert.equal(output.answer.length, 2_500);
  assert.equal(output.sources.length, 5);
  assert.equal(output.sources[0].url, "https://example.org/alerts");
  assert.equal(output.sources[0].publishedAt, undefined);
  assert.equal(output.sources[0].title, "example.org");
  assert.equal(new Set(output.sources.map((source) => source.url)).size, 5);
  assert.match(output.limitations.join(" "), /shortened/);
});

test("unsafe citations alone never establish a grounded answer", async () => {
  globalThis.fetch = async () => Response.json({ answer: "Unsupported claim", citations: [{ url: "data:text/plain,claim" }] });
  const output = await researchWeb({ query: "Find a public source." });
  assert.equal(output.status, "unverified");
  assert.deepEqual(output.sources, []);
});

test("provider HTTP failures do not expose response bodies or credentials", async () => {
  globalThis.fetch = async () => new Response("secret provider details: test-only-key", { status: 401 });
  const output = await researchWeb({ query: "Find official updates." });
  assert.equal(output.status, "unavailable");
  assert.match(output.limitations.join(" "), /HTTP 401/);
  assert.doesNotMatch(JSON.stringify(output), /test-only-key|secret provider details/);
});

test("malformed JSON returns unavailable without an invented answer", async () => {
  globalThis.fetch = async () => new Response("not JSON", { status: 200 });
  const output = await researchWeb({ query: "Find official updates." });
  assert.equal(output.status, "unavailable");
  assert.deepEqual(output.sources, []);
});

test("invalid or oversized public questions do not call the provider", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({}); };
  for (const query of [" ", "x".repeat(1_201)]) {
    assert.equal((await researchWeb({ query })).status, "unavailable");
  }
  assert.equal((await researchWeb({ query: "A question", focus: "x".repeat(301) })).status, "unavailable");
  assert.equal(requests, 0);
});

test("an already cancelled caller does not send a request", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({}); };
  const signal = AbortSignal.abort();
  const output = await researchWeb({ query: "Find official updates.", signal });
  assert.equal(output.status, "unavailable");
  assert.match(output.answer, /cancelled/);
  assert.equal(requests, 0);
});

test("caller cancellation aborts the ongoing provider request", async () => {
  const caller = new AbortController();
  globalThis.fetch = async (_url, options) => {
    const signal = options?.signal;
    assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      caller.abort();
    });
  };
  const output = await researchWeb({ query: "Find official updates.", signal: caller.signal });
  assert.equal(output.status, "unavailable");
  assert.match(output.answer, /cancelled/);
});

test("the voice deadline aborts a stalled request within twelve seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, options) => {
    requestSignal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  };
  const pending = researchWeb({ query: "Find official updates." });
  t.mock.timers.tick(12_000);
  const output = await pending;
  assert.equal(output.status, "unavailable");
  assert.match(output.answer, /timed out/);
});
