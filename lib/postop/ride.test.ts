import test from "node:test";
import assert from "node:assert/strict";
import { reportedRideNeed } from "./ride";
import type { RetellCall } from "@/lib/types";

function response(quote: string | undefined, value: boolean, role = "user"): RetellCall {
  return { call_id: "ride-evidence", transcript_object: quote ? [{ role, content: quote }] : [],
    call_analysis: { custom_analysis_data: { needs_ride: value, needs_ride_quote: quote } } };
}

test("an unasked or ambiguous ride answer never clears a saved flag", () => {
  assert.equal(reportedRideNeed(response(undefined, false)), null);
  assert.equal(reportedRideNeed(response("No.", false)), null);
  assert.equal(reportedRideNeed(response("I think I can leave on my own.", false)), null);
  assert.equal(reportedRideNeed(response("I do not need a ride.", false, "agent")), null);
  assert.equal(reportedRideNeed(response("I need help with medication.", true)), null);
  assert.equal(reportedRideNeed(response("I can leave on my own? No.", false)), null);
  assert.equal(reportedRideNeed(response("My daughter says I can leave on my own.", false)), null);
});

test("explicit consistent transport evidence can set or clear the planning flag", () => {
  for (const quote of ["I need a ride to leave.", "I need help getting out.", "I cannot leave on my own.", "I do not have a ride."]) {
    assert.equal(reportedRideNeed(response(quote, true)), true, quote);
    assert.equal(reportedRideNeed(response(quote, false)), null, "A model boolean cannot contradict the quote.");
  }
  for (const quote of ["I can leave on my own.", "I do not need a ride.", "I don't need help getting out."]) {
    assert.equal(reportedRideNeed(response(quote, false)), false, quote);
  }
});

test("cropped and contradictory quotes cannot establish transport independence", () => {
  const data = response("I do not need a ride.", false);
  data.transcript_object = [{ role: "user", content: "I do not need a ride. Actually, I need a ride to leave." }];
  assert.equal(reportedRideNeed(data), null);
  assert.equal(reportedRideNeed(response("I can leave on my own, but I need a ride.", false)), null);
});

test("explicit Korean transport answers retain their source wording", () => {
  assert.equal(reportedRideNeed(response("대피할 때 도움이 필요해요.", true)), true);
  assert.equal(reportedRideNeed(response("혼자 나갈 수 있어요.", false)), false);
  assert.equal(reportedRideNeed(response("차편은 필요하지 않아요.", false)), false);
});
