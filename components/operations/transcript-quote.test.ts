import assert from "node:assert/strict";
import { test } from "node:test";
import { findCallerQuote } from "./transcript-quote";

test("quote focus highlights the original caller substring, preserving typography and whitespace", () => {
  const content = "Well, I’m   okay, but I need a ride.";
  const result = findCallerQuote([{ role: "user", content }], "I'm okay, but I need a ride.");
  assert.equal(result.length, 1);
  assert.equal(content.slice(result[0].start, result[0].end), "I’m   okay, but I need a ride.");
});
test("agent statements and semantic near-matches never become supporting caller evidence", () => {
  assert.deepEqual(findCallerQuote([{ role: "agent", content: "I need a ride." }], "I need a ride."), []);
  assert.deepEqual(findCallerQuote([{ role: "user", content: "I do not need a ride." }], "I need a ride."), []);
  assert.deepEqual(findCallerQuote([{ role: "user", content: "I need a ride." }], ""), []);
});
test("repeated supporting statements return each caller occurrence instead of claiming a unique match", () => {
  const result = findCallerQuote([{ role: "user", content: "Yes." }, { role: "agent", content: "Yes." }, { role: "user", content: "Yes." }], "Yes.");
  assert.deepEqual(result.map(match => match.turnIndex), [0, 2]);
});
test("short answers match whole words and find a later valid occurrence", () => {
  assert.deepEqual(findCallerQuote([{ role: "user", content: "Yesterday was fine." }], "yes"), []);
  const content = "Yesterday? Yes, I remember.";
  const result = findCallerQuote([{ role: "user", content }], "yes");
  assert.equal(content.slice(result[0].start, result[0].end), "Yes");
  assert.deepEqual(findCallerQuote([{ role: "user", content: "My pain is 30." }], "My pain is 3"), []);
});
