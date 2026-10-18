import { test } from "node:test";
import assert from "node:assert/strict";
import { sortChecksForDashboard } from "./priority-ordering";
import type { CallerAssessment, CheckWithClient, RiskTier } from "./types";

const assessment = (
  priority: CallerAssessment["priority"],
  situation: CallerAssessment["situation"] = "unknown",
  distress: CallerAssessment["distress"] = "unknown",
): CallerAssessment => ({
  priority, situation, distress, audible_distress: "unavailable", transcript_sentiment: null,
  evidence: [], reasons: [], stage: "post_call",
});

function check(name: string, patch: Partial<CheckWithClient> = {}, tier: RiskTier = "red"): CheckWithClient {
  return {
    id: name, event_id: "event", client_id: name, status: "needs_human", ladder_step: 0,
    next_action_at: null, last_call_id: name, summary: null, flag_reason: null,
    handled_at: null, updated_at: "2026-10-17T20:00:00Z", urgency: "urgent", sms_status: null,
    client: {
      id: name, name, phone: "", risk_tier: tier, lives_alone: false, uses_powered_equipment: false,
      emergency_contact_name: "Contact", emergency_contact_phone: "", usual_pickup_time: null,
    },
    ...patch,
  };
}

const names = (checks: readonly CheckWithClient[]) => checks.map((item) => item.client.name);

test("calm immediate danger precedes a panicked routine request regardless of enrollment risk", () => {
  const calmDanger = check("Calm danger", { priority_assessment: assessment("immediate", "immediate_danger", "unknown") }, "green");
  const panickedRoutine = check("Panicked routine", { priority_assessment: assessment("urgent", "routine", "high") }, "red");
  assert.deepEqual(names(sortChecksForDashboard([panickedRoutine, calmDanger], "crisis")), ["Calm danger", "Panicked routine"]);
});

test("reported severity outranks distress even when an old assessment had promoted panic", () => {
  const assistance = check("Quiet assistance", { urgency: "follow_up", priority_assessment: assessment("follow_up", "needs_assistance") }, "green");
  const panic = check("Panicked routine", { priority_assessment: assessment("urgent", "routine", "high") }, "red");
  for (const mode of ["daily", "crisis"] as const) {
    assert.deepEqual(names(sortChecksForDashboard([panic, assistance], mode)), ["Quiet assistance", "Panicked routine"]);
  }
});

test("distress advances review only within the same reported severity tier", () => {
  const quiet = check("A quiet danger", { priority_assessment: assessment("immediate", "immediate_danger", "unknown") });
  const panic = check("Z panicked danger", { priority_assessment: assessment("immediate", "immediate_danger", "high") });
  const lower = check("Panicked assistance", { priority_assessment: assessment("urgent", "needs_assistance", "high") });
  assert.deepEqual(names(sortChecksForDashboard([lower, quiet, panic], "crisis")), ["Z panicked danger", "A quiet danger", "Panicked assistance"]);
});

test("suggestions refine the human queue in immediate, urgent, then follow-up or review order", () => {
  const roster = [
    check("Review", { priority_assessment: assessment("review") }),
    check("Urgent", { priority_assessment: assessment("urgent") }),
    check("Follow up", { priority_assessment: assessment("follow_up") }),
    check("Immediate", { priority_assessment: assessment("immediate") }),
  ];
  assert.deepEqual(names(sortChecksForDashboard(roster, "crisis")), ["Immediate", "Urgent", "Follow up", "Review"]);
});

test("an unassessed urgent concern is not demoted behind routine assessed requests", () => {
  const roster = [
    check("Routine", { priority_assessment: assessment("follow_up", "routine") }),
    check("Unassessed", { priority_assessment: null }),
    check("Immediate", { priority_assessment: assessment("immediate", "immediate_danger") }),
  ];
  assert.deepEqual(names(sortChecksForDashboard(roster, "crisis")), ["Immediate", "Unassessed", "Routine"]);
});

test("daily mode preserves urgent handoffs ahead of ordinary follow-ups", () => {
  const roster = [
    check("Daily follow up", { urgency: "follow_up", priority_assessment: assessment("urgent", "routine", "high") }),
    check("Urgent handoff"),
  ];
  assert.deepEqual(names(sortChecksForDashboard(roster, "daily")), ["Urgent handoff", "Daily follow up"]);
});

test("unanswered and other status buckets retain their existing order", () => {
  const roster = [
    check("Handled", { status: "handled" }),
    check("Okay", { status: "ok" }),
    check("Queued", { status: "queued" }),
    check("Calling", { status: "calling" }),
    check("Unanswered", { status: "no_answer", priority_assessment: assessment("immediate") }),
    check("Human", { priority_assessment: assessment("review") }),
  ];
  const result = sortChecksForDashboard(roster, "crisis");
  assert.deepEqual(names(result), ["Human", "Unanswered", "Calling", "Queued", "Okay", "Handled"]);
  assert.equal(result[1].status, "no_answer");
});

test("legacy rows preserve status, enrollment risk, and name ordering in both modes", () => {
  const roster = [
    check("Z red follow up", { urgency: "follow_up" }),
    check("A green urgent", {}, "green"),
    check("A red follow up", { urgency: "follow_up" }),
    check("Red urgent"),
    check("No answer", { status: "no_answer" }),
  ];
  assert.deepEqual(names(sortChecksForDashboard(roster, "daily")), ["Red urgent", "A green urgent", "A red follow up", "Z red follow up", "No answer"]);
  assert.deepEqual(names(sortChecksForDashboard(roster, "crisis")), ["A red follow up", "Red urgent", "Z red follow up", "A green urgent", "No answer"]);
});

test("equal suggestions keep enrollment risk and alphabetical ties", () => {
  const roster = [
    check("Green", { priority_assessment: assessment("urgent") }, "green"),
    check("Z red", { priority_assessment: assessment("urgent") }),
    check("A red", { priority_assessment: assessment("urgent") }),
  ];
  assert.deepEqual(names(sortChecksForDashboard(roster, "crisis")), ["A red", "Z red", "Green"]);
});

test("sorting returns a new array without changing any source records", () => {
  const roster = [check("Z"), check("A")];
  const original = structuredClone(roster);
  Object.freeze(roster);
  const result = sortChecksForDashboard(roster, "crisis");
  assert.notEqual(result, roster);
  assert.deepEqual(roster, original);
  assert.equal(result[0], roster[1]);
});
