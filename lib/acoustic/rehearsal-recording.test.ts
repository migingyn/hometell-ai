import assert from "node:assert/strict";
import { test } from "node:test";
import { getCallerRecording, getRehearsalCallerRecording } from "./recording";

const binding = { requestId: "reserved-request", checkId: "reserved-check", callId: "call_rehearsal", agentId: "dedicated-agent" };
const bound = { call_id: binding.callId, agent_id: binding.agentId,
  metadata: { rehearsal_request_id: binding.requestId, check_id: binding.checkId, target: "client" as const } };
const url = "https://retellai.s3.us-west-2.amazonaws.com/test/separate-speakers.wav";

test("only exact rehearsal binding can read real caller audio while the roster stays mocked", async () => {
  const old = { key: process.env.RETELL_API_KEY, mock: process.env.MOCK_RETELL, fetch: globalThis.fetch };
  process.env.RETELL_API_KEY = "private-test-key";
  process.env.MOCK_RETELL = "true";
  let record: object = { ...bound, recording_multi_channel_url: url };
  const requested: string[] = [];
  globalThis.fetch = async (input, init) => {
    const target = String(input); requested.push(target);
    assert.equal(init?.redirect, "error");
    if (target.startsWith("https://api.retellai.com/")) {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer private-test-key");
      return Response.json(record);
    }
    assert.equal(target, url);
    assert.equal(init?.headers, undefined, "Provider credentials must not reach the recording host");
    return new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    await assert.rejects(getCallerRecording(binding.callId), /real Retell connection/);
    assert.equal(requested.length, 0);
    assert.equal((await getRehearsalCallerRecording(binding)).bytes.length, 3);
    for (const wrong of [
      { ...bound, call_id: "another-call" }, { ...bound, agent_id: "another-agent" },
      { ...bound, metadata: { ...bound.metadata, rehearsal_request_id: "another-request" } },
      { ...bound, metadata: { ...bound.metadata, check_id: "another-check" } },
      { ...bound, metadata: { ...bound.metadata, target: "emergency_contact" } },
    ]) {
      record = { ...wrong, recording_multi_channel_url: url };
      const count: number = requested.length;
      await assert.rejects(getRehearsalCallerRecording(binding), /different call|binding mismatch/);
      assert.equal(requested.length, count + 1, "Mismatched calls must fail before recording download");
    }
    record = { ...bound, recording_url: url };
    await assert.rejects(getRehearsalCallerRecording(binding), /Separate-speaker/);
    await assert.rejects(getRehearsalCallerRecording(binding, { ...bound,
      metadata: { ...bound.metadata, check_id: "other" }, recording_multi_channel_url: url }), /Separate-speaker/);
    const result = await getRehearsalCallerRecording(binding, { ...bound, recording_multi_channel_url: url,
      transcript_object: [{ role: "user", content: "Private words", words: [{ start: 2, end: 5 }] }] });
    assert.deepEqual(result.segments, [{ role: "user", start: 2, end: 5 }]);
    await assert.rejects(getRehearsalCallerRecording(binding, { ...bound,
      recording_multi_channel_url: "https://127.0.0.1/private" }), /approved/);
    assert.equal(process.env.MOCK_RETELL, "true");
  } finally {
    globalThis.fetch = old.fetch;
    if (old.key === undefined) delete process.env.RETELL_API_KEY; else process.env.RETELL_API_KEY = old.key;
    if (old.mock === undefined) delete process.env.MOCK_RETELL; else process.env.MOCK_RETELL = old.mock;
  }
});
