import assert from "node:assert/strict";
import { test } from "node:test";
import type { AcousticAssessment } from "../../lib/acoustic/types";
import { currentVoiceAnalysis, voiceAnalysisResolved, type VoiceAnalysisState } from "./voice-analysis";

const done: VoiceAnalysisState = { status: "available", signal: "elevated", updatedAt: "2026-10-17T19:00:00Z", retryPending: false };
const saved = { call_id: "previous-call", analyzed_at: done.updatedAt, result: { status: "available", signal: "elevated" } } as AcousticAssessment;

test("switching calls cannot display the previous caller's voice result", () => {
  assert.equal(currentVoiceAnalysis("current-call", { callId: "previous-call", voiceAnalysis: done }, saved), null);
  assert.equal(currentVoiceAnalysis(null, { callId: null, voiceAnalysis: done }, saved), null);
});

test("current saved voice evidence survives an evidence fetch outage", () => {
  assert.deepEqual(currentVoiceAnalysis("previous-call", undefined, saved), done);
});

test("pending server retry wins over a saved unavailable result", () => {
  const retry: VoiceAnalysisState = { status: "waiting_for_recording", signal: null, updatedAt: null, retryPending: true };
  assert.equal(currentVoiceAnalysis("previous-call", { callId: "previous-call", voiceAnalysis: retry }, saved), retry);
  assert.equal(voiceAnalysisResolved(retry), false);
  assert.equal(voiceAnalysisResolved({ ...done, status: "unavailable", retryPending: true }), false);
});

test("post-call polling stops only when a result or final fallback resolves", () => {
  assert.equal(voiceAnalysisResolved(undefined), false);
  assert.equal(voiceAnalysisResolved({ ...done, status: "processing" }), false);
  assert.equal(voiceAnalysisResolved(done), true);
  assert.equal(voiceAnalysisResolved({ ...done, status: "insufficient_audio", signal: null }), true);
  assert.equal(voiceAnalysisResolved({ ...done, status: "unavailable", signal: null }), true);
});
