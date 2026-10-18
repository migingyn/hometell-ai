import assert from "node:assert/strict";
import { test } from "node:test";
import { transcriptAdvances, transcriptSnapshot, transcriptStatus } from "./snapshot";
import type { RetellCall } from "@/lib/types";

const callId = "call_transcript_test";
const snapshot = (text: string, end?: number) => transcriptSnapshot({ call_id: callId,
  transcript_object: [{ role: "user", content: text, ...(end === undefined ? {} : { words: [{ start: 1, end }] }) }] });

test("speech carries stable call-scoped IDs, valid timing and redacted phone numbers; tools are excluded", () => {
  const result = transcriptSnapshot({ call_id: callId, transcript_object: [
    { role: "agent", content: "How are you?", words: [{ start: 0, end: 1 }] },
    { role: "tool_call_invocation", content: "private function payload" },
    { role: "user", content: "Call +1 (202) 555-0199 please.", words: [{ start: 2, end: 3.5 }] },
  ] });
  assert.equal(result.turnCount, 2);
  assert.equal(result.turns[1].id, `${callId}:turn:1`);
  assert.equal(result.turns[1].content, "Call [phone redacted] please.");
  assert.equal(result.turns[1].endSeconds, 3.5);
  assert.equal(result.endSeconds, 3.5);
  assert.equal(result.truncated, false);
});

test("a growing utterance at the same turn count advances without timestamps", () => {
  assert.equal(transcriptAdvances(snapshot("I need"), snapshot("I need a ride.")), true);
  assert.equal(transcriptAdvances(snapshot("I need a ride."), snapshot("I need")), false);
});

test("older provider timing cannot replace a newer utterance even with more text", () => {
  assert.equal(transcriptAdvances(snapshot("I am safe.", 10), snapshot("Earlier I was very worried.", 5)), false);
  assert.equal(transcriptAdvances(snapshot("I am worried.", 5), snapshot("I am safe.", 10)), true);
});

test("ambiguous equal-position rewrites preserve the first until terminal evidence", () => {
  assert.equal(transcriptAdvances(snapshot("I am fine."), snapshot("I am sore.")), false);
  assert.equal(transcriptAdvances(snapshot("I am fine."), snapshot("I am sore."), true), true);
  assert.equal(transcriptAdvances(snapshot("I am fine."), snapshot("An older but longer answer.")), false);
});

test("a terminal callback cannot erase previously received complete turns", () => {
  const complete = transcriptSnapshot({ call_id: callId, transcript_object: [
    { role: "agent", content: "Do you need help?" }, { role: "user", content: "I need a ride." },
  ] });
  assert.equal(transcriptAdvances(complete, snapshot("I need a ride."), true), false);
  assert.equal(transcriptAdvances(complete, transcriptSnapshot({ call_id: callId }), true), false);
});

test("plain transcript fallback preserves multiline speech and discards unknown speaker blocks", () => {
  const result = transcriptSnapshot({ call_id: callId, transcript: "Agent: Hi\nUser: I need help\nwith transport.\nTool: internal\nnot speech\nUser: Thank you" });
  assert.deepEqual(result.turns.map((turn) => turn.content), ["Hi", "I need help\nwith transport.", "Thank you"]);
});

test("ordinary calls retain over 120 turns and explicitly mark resource-limit truncation", () => {
  const transcript_object = Array.from({ length: 1_001 }, (_, i) => ({ role: i % 2 ? "user" : "agent", content: `Utterance ${i}` }));
  const result = transcriptSnapshot({ call_id: callId, transcript_object });
  assert.equal(result.turnCount, 1_000);
  assert.equal(result.truncated, true);
  assert.equal(transcriptSnapshot({ call_id: callId, transcript_object: transcript_object.slice(0, 150) }).turnCount, 150);
});

test("empty and malformed timing never invent speech or finite timestamps", () => {
  assert.deepEqual(transcriptSnapshot({ call_id: callId }).turns, []);
  const result = transcriptSnapshot({ call_id: callId, transcript_object: [{ role: "user", content: "Hello", words: [
    { start: Number.NaN, end: -4 }, { start: -1, end: Number.POSITIVE_INFINITY },
  ] }] } as RetellCall);
  assert.equal(result.endSeconds, null);
  assert.equal(result.turns[0].startSeconds, null);
});

test("transport end and final analysis have distinct states", () => {
  assert.equal(transcriptStatus("call_started"), "ongoing");
  assert.equal(transcriptStatus("transcript_updated"), "ongoing");
  assert.equal(transcriptStatus("call_ended"), "ended");
  assert.equal(transcriptStatus("call_analyzed"), "analyzed");
});
