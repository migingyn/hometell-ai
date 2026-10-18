import assert from "node:assert/strict";
import test from "node:test";
import { AcousticResponse, speakerSegments, unavailableAudio } from "./client";
import { allowedRecordingUrl, getCallerRecording, MAX_RECORDING_BYTES, readBoundedAudio } from "./recording";

test("timing export omits transcript text and invalid speaker/times", () => {
  assert.deepEqual(speakerSegments([
    { role: "user", content: "Private words", words: [{ start: 2, end: 3 }, { start: 3, end: 4 }] },
    { role: "agent", words: [{ start: 0, end: 1 }] },
    { role: "tool", words: [{ start: 5, end: 6 }] },
    { role: "user", words: [{ start: -1, end: 5 }, { start: 8, end: 7 }, { start: NaN, end: 9 }] },
  ]), [{ role: "user", start: 2, end: 4 }, { role: "agent", start: 0, end: 1 }]);
});

test("service response cannot label missing caller audio as an available signal", () => {
  const unavailable = unavailableAudio("Not configured");
  assert.equal(AcousticResponse.safeParse(unavailable).success, true);
  assert.equal(AcousticResponse.safeParse({ ...unavailable, status: "available", signal: "elevated" }).success, false);
  assert.equal(AcousticResponse.safeParse({ ...unavailable, signal: "elevated" }).success, false);
});

test("recordings use exact approved HTTPS hosts and never redirect to local endpoints", () => {
  assert.equal(allowedRecordingUrl("https://retellai.s3.us-west-2.amazonaws.com/call/recording.wav").protocol, "https:");
  assert.equal(allowedRecordingUrl("https://cdn.example.org/file?signature=private", "cdn.example.org").hostname, "cdn.example.org");
  for (const url of ["http://retellai.s3.us-west-2.amazonaws.com/a", "https://127.0.0.1/a", "https://retellai.s3.us-west-2.amazonaws.com.attacker.org/a", "https://user@retellai.s3.us-west-2.amazonaws.com/a", "https://retellai.s3.us-west-2.amazonaws.com:3000/a"]) {
    assert.throws(() => allowedRecordingUrl(url, ""));
  }
});

test("streamed recording download bounds both declared and chunked bodies", async () => {
  assert.deepEqual(await readBoundedAudio(new Response(new Uint8Array([1, 2, 3]))), new Uint8Array([1, 2, 3]));
  await assert.rejects(readBoundedAudio(new Response("x", { headers: { "content-length": String(MAX_RECORDING_BYTES + 1) } })), /large/);
  await assert.rejects(readBoundedAudio(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_RECORDING_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();
  } }))), /large/);
  await assert.rejects(readBoundedAudio(new Response("")), /empty/);
});

test("recording retrieval keeps credentials at Retell and accepts only a matching-call webhook fallback", async () => {
  const previous = { key: process.env.RETELL_API_KEY, mock: process.env.MOCK_RETELL, fetch: globalThis.fetch };
  process.env.RETELL_API_KEY = "test-private-key";
  process.env.MOCK_RETELL = "false";
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return String(url).startsWith("https://api.retellai.com/")
      ? Response.json({ call_id: "fixture-call" })
      : new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    const result = await getCallerRecording("fixture-call", { call_id: "fixture-call",
      recording_multi_channel_url: "https://retellai.s3.us-west-2.amazonaws.com/fixture/recording.wav" });
    assert.equal(result.bytes.length, 3);
    assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer test-private-key");
    assert.equal(requests[1].init?.headers, undefined);
    assert.equal(requests[1].init?.redirect, "error");
    await assert.rejects(getCallerRecording("fixture-call", { call_id: "different-call",
      recording_multi_channel_url: "https://retellai.s3.us-west-2.amazonaws.com/other/recording.wav" }), /unavailable/);
    await assert.rejects(getCallerRecording("fixture-call", { call_id: "fixture-call",
      recording_multi_channel_url: "https://localhost/private" }), /approved/);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.RETELL_API_KEY; else process.env.RETELL_API_KEY = previous.key;
    if (previous.mock === undefined) delete process.env.MOCK_RETELL; else process.env.MOCK_RETELL = previous.mock;
  }
});
