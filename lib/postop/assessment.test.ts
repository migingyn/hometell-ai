import test from "node:test";
import assert from "node:assert/strict";
import { buildPostOpAssessment, reportedPainScore } from "./assessment";
import { nextNurseTransferStatus } from "./transfer";
import type { RetellCall } from "@/lib/types";

function call(overrides: Partial<RetellCall> = {}): RetellCall {
  return {
    call_id: "call_current",
    metadata: { check_id: "check", target: "client", mode: "daily" },
    transcript_object: [
      { role: "agent", content: "Is this Jane?" }, { role: "user", content: "Yes, this is Jane." },
      { role: "agent", content: "How is your incision? No redness?" },
      { role: "user", content: "The incision looks red today." },
      { role: "user", content: "My pain is seven out of ten." },
    ],
    call_analysis: { custom_analysis_data: {
      postop_patient_confirmed: true, postop_identity_quote: "Yes, this is Jane.",
      postop_pain_score: 7, postop_pain_quote: "My pain is seven out of ten.",
      postop_incision_quote: "The incision looks red today.",
    } },
    ...overrides,
  };
}
const context = { mode: "daily" as const, target: "client" as const };

test("post-op answers retain exact patient evidence and leave missing fields unknown", () => {
  const record = buildPostOpAssessment(call(), context)!;
  assert.equal(record.answers.pain.value, 7);
  assert.equal(record.answers.incision.quote, "The incision looks red today.");
  assert.equal(record.answers.fever.status, "unknown");
  assert.equal(record.answers.fever.value, null);
  assert.equal(record.comparison.status, "no_previous_check");
  assert.equal(record.changes.length, 0);
  assert.equal(record.suggested_next_step.status, "proposed");
});

test("agent speech, invented quotes, cropped negation and unconfirmed identity cannot populate answers", () => {
  const data = call();
  Object.assign(data.call_analysis!.custom_analysis_data!, {
    postop_incision_quote: "How is your incision? No redness?", postop_fever_quote: "No fever.",
    postop_breathing_quote: "incision looks red",
  });
  const record = buildPostOpAssessment(data, context)!;
  for (const field of ["incision", "fever", "breathing"] as const) assert.equal(record.answers[field].status, "unknown");
  data.call_analysis!.custom_analysis_data!.postop_patient_confirmed = false;
  assert.ok(Object.values(buildPostOpAssessment(data, context)!.answers).every((answer) => answer.status === "unknown"));
});

test("crisis and emergency-contact calls never create patient post-op records", () => {
  assert.equal(buildPostOpAssessment(call(), { mode: "crisis", target: "client" }), null);
  assert.equal(buildPostOpAssessment(call(), { mode: "daily", target: "emergency_contact" }), null);
});

test("a third party identifying themselves cannot become the patient", () => {
  const data = call();
  data.transcript_object!.unshift({ role: "user", content: "I'm her daughter." });
  data.call_analysis!.custom_analysis_data!.postop_identity_quote = "I'm her daughter.";
  const record = buildPostOpAssessment(data, context)!;
  assert.equal(record.patient_confirmed, false);
  assert.equal(record.answers.pain.status, "unknown");
});

test("a model identity label cannot turn an unrelated answer into identity confirmation", () => {
  const data = call();
  data.call_analysis!.custom_analysis_data!.postop_identity_quote = "The incision looks red today.";
  assert.equal(buildPostOpAssessment(data, context)!.patient_confirmed, false);
});

test("yes must answer the named patient's identity question and uncertainty stays unknown", () => {
  const data = call();
  data.transcript_object![1].content = "Yes.";
  data.call_analysis!.custom_analysis_data!.postop_identity_quote = "Yes.";
  data.transcript_object!.push({ role: "user", content: "I haven't checked my temperature." });
  data.call_analysis!.custom_analysis_data!.postop_fever_quote = "I haven't checked my temperature.";
  const record = buildPostOpAssessment(data, { ...context, patientName: "Jane" })!;
  assert.equal(record.patient_confirmed, true);
  assert.equal(record.answers.fever.status, "unknown");
  assert.equal(record.answers.fever.quote, "I haven't checked my temperature.");
  assert.equal(buildPostOpAssessment(data, { ...context, patientName: "John" })!.patient_confirmed, false);
});

test("changes compare recorded values only and never treat a missing prior answer as normal", () => {
  const previous = buildPostOpAssessment(call({ call_id: "call_previous" }), context)!;
  previous.answers.pain = { status: "reported", value: 3, quote: "My pain is three." };
  const record = buildPostOpAssessment(call(), context, previous)!;
  assert.deepEqual(record.changes.map((change) => change.field), ["pain"]);
  assert.equal(record.changes[0].previous, 3);
  assert.equal(record.changes[0].current, 7);
  assert.ok(record.comparison.unavailable_fields.includes("fever"));
  previous.answers.pain = { status: "unknown", value: null, quote: null };
  assert.equal(buildPostOpAssessment(call(), context, previous)!.changes.length, 0);
  assert.equal(buildPostOpAssessment(call(), context, record)!.comparison.status, "no_previous_check");
});

test("pain needs explicit consistent current numeric evidence; no inferred threshold", () => {
  assert.equal(reportedPainScore(0, "Zero."), 0);
  assert.equal(reportedPainScore(4, "My pain is 4/10."), 4);
  assert.equal(reportedPainScore(7, "It was seven yesterday, now it is three."), null);
  assert.equal(reportedPainScore(7, "Not seven, three."), null);
  assert.equal(reportedPainScore(7, "It hurts a lot."), null);
  assert.equal(reportedPainScore(11, "Eleven."), null);
  assert.equal(reportedPainScore(7, "Maybe seven."), null);
});

test("structured speaker attribution wins over contradictory plain transcript", () => {
  const data = call({ transcript: "User: Yes, this is Jane.\nUser: My pain is seven out of ten.", transcript_object: [] });
  assert.equal(buildPostOpAssessment(data, context)!.answers.pain.status, "unknown");
});

test("transfer events never infer success from ended or regress confirmed connection", () => {
  assert.equal(nextNurseTransferStatus(null, "transfer_ended"), "ended_unconfirmed");
  assert.equal(nextNurseTransferStatus("failed", "transfer_ended"), "failed");
  assert.equal(nextNurseTransferStatus("connected", "transfer_started"), "connected");
  assert.equal(nextNurseTransferStatus("connected", "transfer_cancelled"), "connected");
  assert.equal(nextNurseTransferStatus("failed", "transfer_bridged"), "connected");
});
