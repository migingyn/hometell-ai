import { test } from "node:test";
import assert from "node:assert/strict";
import { retellClassifier } from "../classifier/retell";
import { llmClassifier } from "../classifier/llm";

test("a successful connection and positive summary never become an invented wellbeing status", async () => {
  const result = await retellClassifier.classify({ call_id: "call_test", call_status: "ended", call_analysis: { call_successful: true, call_summary: "The call connected." } });
  assert.equal(result.status, "needs_human");
  assert.equal(result.flag_reason, "unclear call, needs review");
  assert.equal(result.summary, "The call connected.");
});

test("unanswered and voicemail calls stay unresolved", async () => {
  for (const disconnection_reason of ["voicemail_reached", "dial_no_answer", "dial_busy", "dial_failed"]) {
    const result = await retellClassifier.classify({ call_id: "call_test", disconnection_reason });
    assert.equal(result.status, "no_answer");
  }
  assert.equal((await retellClassifier.classify({ call_id: "call_test", call_analysis: { in_voicemail: true } })).status, "no_answer");
});

test("the unfinished optional classifier requests review instead of fake success", async () => {
  const result = await llmClassifier.classify({ call_id: "call_test" });
  assert.equal(result.status, "needs_human");
  assert.doesNotMatch(result.summary, /fake/i);
});
