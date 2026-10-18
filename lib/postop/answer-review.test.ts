import assert from "node:assert/strict";
import { test } from "node:test";
import { AnswerReviewInput, allowsAnswerReviewOrigin, publicAnswerReview, reviewFailure, type AnswerReview } from "./answer-review";

const base = { call_id: "call_review", field: "pain", action: "confirm", reviewer: "KP", expected_revision: 0, expected_source: "a".repeat(32) };
test("answer review rejects cross-origin browser writes and permits local CLI requests", () => {
  const req = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3018/api/checks/test/answer-review", { method: "POST", headers });
  assert.equal(allowsAnswerReviewOrigin(req()), true);
  assert.equal(allowsAnswerReviewOrigin(req({ origin: "http://127.0.0.1:3018", "sec-fetch-site": "same-origin" })), true);
  const rejectedHeaders: Record<string, string>[] = [{ origin: "https://example.com" }, { origin: "null" }, { origin: "http://127.0.0.1:3019" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of rejectedHeaders) {
    assert.equal(allowsAnswerReviewOrigin(req(headers)), false);
  }
});
test("review intent binds to an extraction and revision without accepting arbitrary fields", () => {
  assert.equal(AnswerReviewInput.safeParse(base).success, true);
  for (const update of [{ expected_source: undefined }, { expected_source: "old" }, { expected_revision: -1 },
    { expected_revision: 1.5 }, { field: "diagnosis" }, { reviewer: " " }, { call_id: "" }, { original_answer: {} }]) {
    assert.equal(AnswerReviewInput.safeParse({ ...base, ...update }).success, false);
  }
});
test("corrections distinguish explicit unknown from omitted, empty or invalid values", () => {
  const correct = { ...base, action: "correct" };
  for (const value of [null, 0, 5.5, 10]) assert.equal(AnswerReviewInput.safeParse({ ...correct, corrected_value: value }).success, true);
  for (const value of [undefined, "5", -1, 11, Infinity, "", true]) assert.equal(AnswerReviewInput.safeParse({ ...correct, corrected_value: value }).success, false);
  for (const value of [null, "No change reported"]) assert.equal(AnswerReviewInput.safeParse({ ...correct, field: "incision", corrected_value: value }).success, true);
  for (const value of [4, " ", "x".repeat(2001)]) assert.equal(AnswerReviewInput.safeParse({ ...correct, field: "incision", corrected_value: value }).success, false);
  assert.equal(AnswerReviewInput.safeParse({ ...base, corrected_value: null }).success, false);
});
test("public corrections retain original evidence and never mutate its audit snapshot", () => {
  const record: AnswerReview = { id: "review", check_id: "check", call_id: "call", field: "pain", action: "correct",
    original_answer: { status: "reported", value: 7, quote: "My pain is seven. Call +1 202 555 0199." },
    corrected_value: 4, reviewer: "KP", reviewed_at: "2026-10-18T03:00:00Z", revision: 2,
    source_fingerprint: "a".repeat(32), source_current: false };
  const original = structuredClone(record);
  const result = publicAnswerReview(record);
  assert.deepEqual(record, original);
  assert.equal(result.original_answer.value, 7);
  assert.equal(result.corrected_value, 4);
  assert.match(result.original_answer.quote!, /My pain is seven/);
  assert.doesNotMatch(result.original_answer.quote!, /202/);
  assert.equal(result.source_fingerprint, record.source_fingerprint);
  assert.equal(result.source_current, false);
  const confirmed = publicAnswerReview({ ...record, action: "confirm" });
  assert.equal(Object.hasOwn(confirmed, "corrected_value"), false);
});
test("stale source, competing revision and stale call remain conflicts; unknown calls are missing", () => {
  for (const kind of ["source_changed", "revision_conflict", "stale_call", "handled"]) assert.equal(reviewFailure(kind).status, 409);
  for (const kind of ["unknown_check", "unknown_call", "no_assessment"]) assert.equal(reviewFailure(kind).status, 404);
  assert.equal(reviewFailure("unknown_answer").status, 400);
});
