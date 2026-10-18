import assert from "node:assert/strict";
import { test } from "node:test";
import { POSTOP_FIELDS } from "@/lib/postop/types";
import type { AnswerReview, AnswerReviewData } from "./answer-review-types";
import { answerDraftConflict, mergeAnswerRead, mergeAnswerReceipt, openAnswerDraft } from "./answer-review-state";

function data(fingerprint = "original"): AnswerReviewData {
  return { checkId: "check-one", callId: "call-one", reviews: [], sources: Object.fromEntries(POSTOP_FIELDS.map(field => [field,
    { fingerprint, answer: { status: "reported", value: field === "pain" ? 3 : "reported answer", quote: "My pain is 3." } }])) as AnswerReviewData["sources"] };
}
function receipt(revision: number, fingerprint = "original"): AnswerReview {
  return { id: `review-${revision}`, check_id: "check-one", call_id: "call-one", field: "pain", action: "correct",
    original_answer: { status: "reported", value: 3, quote: "My pain is 3." }, corrected_value: 4,
    reviewer: "Reviewer", reviewed_at: "2026-10-18T00:00:00Z", revision, source_fingerprint: fingerprint, source_current: true };
}
test("draft keeps its opening call, source and revision and rejects silent rebasing", () => {
  const initial = data();
  const draft = { ...openAnswerDraft(initial, "pain"), value: "7" };
  assert.equal(answerDraftConflict(draft, initial), null);
  assert.match(answerDraftConflict(draft, data("new-extraction"))!, /extraction changed/);
  assert.match(answerDraftConflict(draft, { ...initial, reviews: [receipt(1)] })!, /newer review/);
  assert.match(answerDraftConflict(draft, { ...initial, callId: "call-two" })!, /selected call changed/);
  assert.equal(draft.fingerprint, "original");
  assert.equal(draft.revision, 0);
});
test("POST receipt arriving after a new extraction is retained only as stale evidence", () => {
  const merged = mergeAnswerReceipt(data("new-extraction"), receipt(1));
  assert.equal(merged.sources.pain.fingerprint, "new-extraction");
  assert.equal(merged.reviews[0].source_current, false);
});
test("older or same-revision POST responses cannot replace a newer GET review", () => {
  const latest = { ...data("new-extraction"), reviews: [receipt(2, "new-extraction")] };
  assert.equal(mergeAnswerReceipt(latest, receipt(1)), latest);
  assert.equal(mergeAnswerReceipt(latest, receipt(2)), latest);
  assert.equal(mergeAnswerReceipt(latest, { ...receipt(3), call_id: "different-call" }), latest);
});
test("a late GET cannot remove a newer saved receipt and must recompute source freshness", () => {
  const saved = { ...data(), reviews: [receipt(2)] };
  const merged = mergeAnswerRead(saved, { ...data("new-extraction"), reviews: [receipt(1)] });
  assert.equal(merged.reviews[0].revision, 2);
  assert.equal(merged.reviews[0].source_current, false);
  assert.equal(merged.sources.pain.fingerprint, "new-extraction");
});
