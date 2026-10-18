import test from "node:test";
import assert from "node:assert/strict";
import { evidenceTurns, redactPhoneNumbers } from "./evidence";

test("evidence excludes tool text and respects authoritative empty transcripts", () => {
  assert.deepEqual(evidenceTurns({ call_id: "demo", transcript: "User: Secret fallback", transcript_object: [] }), []);
  assert.deepEqual(evidenceTurns({ call_id: "demo", transcript_with_tool_calls: [
    { role: "tool_call_result", content: "Private provider metadata" }, { role: "user", content: "I need a ride." },
  ] }), [{ role: "user", content: "I need a ride." }]);
});

test("phone numbers are redacted without erasing ordinary clinical reports", () => {
  assert.equal(redactPhoneNumbers("Call +1 (202) 555-0110. Pain is 3/10; temperature is 98.6."), "Call [phone redacted]. Pain is 3/10; temperature is 98.6.");
});
