import assert from "node:assert/strict";
import { test } from "node:test";
import { combineAcousticPriority } from "./policy";
import type { CallerAssessment } from "@/lib/types";
import type { AcousticAnalysis } from "./types";

function priority(patch: Partial<CallerAssessment> = {}): CallerAssessment {
  return { priority: "follow_up", situation: "routine", distress: "unknown", audible_distress: "unavailable",
    transcript_sentiment: null, evidence: [{ kind: "situation", quote: "I am at the shelter." }],
    reasons: ["The caller reports routine circumstances.", "Audible distress is unavailable: transcript analysis does not measure tone, pitch, or breathing."],
    stage: "post_call", ...patch };
}

function analysis(patch: Partial<AcousticAnalysis> = {}): AcousticAnalysis {
  return { version: "1", status: "available", signal: "elevated", model: { id: "local-expression-model", revision: "test", labels: ["angry", "neutral"] },
    scores: { angry: 0.7, neutral: 0.3 }, quality: { duration_seconds: 12, speech_seconds: 8, clipping_fraction: 0,
      sample_rate: 16000, channels: 2, caller_channel: 1, window_count: 2 }, segments: [], warnings: [], ...patch };
}

test("elevated expression in routine circumstances requests review without claiming an emergency", () => {
  const result = combineAcousticPriority(priority(), analysis());
  assert.equal(result.priority, "review");
  assert.equal(result.situation, "routine");
  assert.equal(result.distress, "unknown");
  assert.equal(result.audible_distress, "elevated");
  assert.ok(result.reasons.some((reason) => reason.includes("speech-expression signal")));
  assert.ok(result.reasons.every((reason) => !reason.startsWith("Audible distress is unavailable:")));
});

test("unknown circumstances or assistance retain their severity when expression is elevated", () => {
  for (const situation of ["unknown", "needs_assistance"] as const) {
    const result = combineAcousticPriority(priority({ situation, priority: "review" }), analysis());
    assert.equal(result.priority, "review", situation);
    assert.notEqual(result.priority, "immediate", situation);
  }
});

test("recording failures and insufficient audio preserve existing priorities and available signals", () => {
  for (const status of ["unavailable", "insufficient_audio"] as const) {
    for (const existing of ["follow_up", "review", "urgent", "immediate"] as const) {
      const source = priority({ priority: existing, audible_distress: "elevated" });
      assert.deepEqual(combineAcousticPriority(source, analysis({ status, signal: "uncertain" })), source);
    }
  }
});

test("uncertain expression never lowers an existing priority or becomes reassurance", () => {
  for (const existing of ["follow_up", "review", "urgent", "immediate"] as const) {
    const result = combineAcousticPriority(priority({ priority: existing, audible_distress: "elevated" }), analysis({ signal: "uncertain" }));
    assert.equal(result.priority, existing);
    assert.equal(result.audible_distress, "uncertain");
    assert.ok(result.reasons.some((reason) => reason.includes("does not establish distress or safety")));
  }
});

test("reported immediate danger retains its floor but distress never raises severity", () => {
  const calmDanger = combineAcousticPriority(priority({ situation: "immediate_danger", priority: "immediate" }), analysis({ signal: "uncertain" }));
  assert.equal(calmDanger.priority, "immediate");
  assert.equal(combineAcousticPriority(priority({ distress: "high", priority: "urgent" }), analysis()).priority, "urgent");
  assert.equal(combineAcousticPriority(priority({ situation: "immediate_danger" }), analysis()).priority, "immediate");
  assert.equal(combineAcousticPriority(priority({ distress: "high" }), analysis({ status: "unavailable" })).priority, "follow_up");
});

test("elevated expression preserves an existing hard-rule priority", () => {
  const source = priority({ priority: "urgent", reasons: ['Caller said "dizzy"; urgent human review remains required.'] });
  const result = combineAcousticPriority(source, analysis());
  assert.equal(result.priority, "urgent");
  assert.ok(result.reasons.includes(source.reasons[0]));
});

test("combination is idempotent and does not mutate either source", () => {
  const source = priority();
  const recording = analysis();
  const original = structuredClone({ source, recording });
  const once = combineAcousticPriority(source, recording);
  const twice = combineAcousticPriority(once, recording);
  assert.deepEqual(once, twice);
  assert.deepEqual({ source, recording }, original);
  assert.notEqual(once.evidence, source.evidence);
});

test("model class scores never become transcript sentiment, reported distress, or panic probabilities", () => {
  const result = combineAcousticPriority(priority({ transcript_sentiment: "Positive" }), analysis({ scores: { angry: 1, neutral: 0 } }));
  assert.equal(result.transcript_sentiment, "Positive");
  assert.equal(result.distress, "unknown");
  assert.equal(result.priority, "review");
  assert.ok(result.reasons.some((reason) => reason.includes("not a determination of panic or safety")));
});
