import assert from "node:assert/strict";
import { test } from "node:test";
import { rehearsalAcousticsDue } from "./rehearsal-acoustic";
import { rehearsalVoiceAnalysis, type RehearsalRow } from "./rehearsal";

const now = Date.parse("2026-10-17T18:00:00Z");
const row = { call_id: "call_rehearsal", status: "analyzed", acoustic_status: "waiting_for_call" } as RehearsalRow;

test("rehearsal audio waits for final words and excludes mock calls and terminal jobs", () => {
  assert.equal(rehearsalAcousticsDue(row, now), true);
  for (const status of ["reserved", "requested", "ongoing", "ended"] as const) {
    assert.equal(rehearsalAcousticsDue({ ...row, status }, now), false);
  }
  assert.equal(rehearsalAcousticsDue({ ...row, call_id: "mock_rehearsal" }, now), false);
  assert.equal(rehearsalAcousticsDue({ ...row, call_id: null }, now), false);
  for (const acoustic_status of ["available", "insufficient_audio", "unavailable"] as const) {
    assert.equal(rehearsalAcousticsDue({ ...row, acoustic_status }, now), false);
  }
});

test("polling respects active job lease and retry deadline; expired jobs can recover", () => {
  const later = new Date(now + 60_000).toISOString(), earlier = new Date(now - 1).toISOString();
  assert.equal(rehearsalAcousticsDue({ ...row, acoustic_status: "processing", acoustic_lease_until: later }, now), false);
  assert.equal(rehearsalAcousticsDue({ ...row, acoustic_status: "processing", acoustic_lease_until: earlier }, now), true);
  assert.equal(rehearsalAcousticsDue({ ...row, acoustic_retry_at: later }, now), false);
  assert.equal(rehearsalAcousticsDue({ ...row, acoustic_retry_at: earlier }, now), true);
});

test("public voice state never describes missing or unusable audio as an available signal", () => {
  assert.deepEqual(rehearsalVoiceAnalysis(row), { status: "waiting_for_recording", signal: null, updatedAt: null, retryPending: false });
  assert.equal(rehearsalVoiceAnalysis({ ...row, status: "ongoing" }).status, "waiting_for_call");
  for (const acoustic_status of ["processing", "insufficient_audio", "unavailable"] as const) {
    assert.equal(rehearsalVoiceAnalysis({ ...row, acoustic_status, acoustic_signal: "elevated" }).signal, null);
  }
  const available = rehearsalVoiceAnalysis({ ...row, acoustic_status: "available", acoustic_signal: "uncertain" });
  assert.equal(available.signal, "uncertain");
  assert.equal(available.retryPending, false);
  assert.equal(rehearsalVoiceAnalysis({ ...row, acoustic_status: "waiting_for_recording", acoustic_retry_at: new Date(now).toISOString() }).retryPending, true);
});
