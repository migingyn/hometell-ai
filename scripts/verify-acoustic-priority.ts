// Real local PostgreSQL persistence checks; acoustic model responses are synthetic fixtures.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { combineAcousticPriority } from "../lib/acoustic/policy";
import type { AcousticAnalysis, AcousticAssessment } from "../lib/acoustic/types";
import { assessCallerPriority } from "../lib/classifier/priority";
import { supabaseAdmin } from "../lib/supabase";
import type { ApiResult, CallerAssessment, CallTarget, Check } from "../lib/types";

type ApplyResult = {
  applied?: boolean;
  newly_escalated?: boolean;
  duplicate?: boolean;
  skipped?: string;
  check?: Check;
};

function syntheticAnalysis(signal: AcousticAnalysis["signal"], status: AcousticAnalysis["status"] = "available"): AcousticAnalysis {
  return {
    version: "1", status, signal,
    model: { id: "fixture/synthetic-acoustic-response", revision: "persistence-test-only", labels: ["fearful", "neutral"] },
    scores: status === "available" ? { fearful: signal === "elevated" ? 0.95 : 0.1, neutral: signal === "elevated" ? 0.05 : 0.9 } : {},
    quality: { duration_seconds: 8, speech_seconds: 6, clipping_fraction: 0, sample_rate: 16000,
      channels: 1, caller_channel: 0, channel_attribution: "explicit", window_count: status === "available" ? 1 : 0 },
    segments: status === "available" ? [{ start_seconds: 0, end_seconds: 8, signal,
      scores: { fearful: signal === "elevated" ? 0.95 : 0.1, neutral: signal === "elevated" ? 0.05 : 0.9 } }] : [],
    warnings: ["Synthetic model response: persistence verification only, not evidence of emotion-classification accuracy."],
  };
}

async function main() {
  const base = new URL(process.env.CALLER_PRIORITY_APP_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3017");
  const databaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid.local");
  if (process.env.MOCK_RETELL !== "true" || !["localhost", "127.0.0.1"].includes(base.hostname) ||
      databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "55321") {
    throw new Error("Acoustic verification requires this project's local database and MOCK_RETELL=true. Nothing was changed.");
  }
  const health = await fetch(new URL("/api/health", base)).then((response) => response.json()) as ApiResult<{ mockMode: boolean }>;
  assert.ok(health.ok && health.data.mockMode, "The running local app must also be in mock mode.");
  const db = supabaseAdmin();
  const eventId = randomUUID();
  const clientIds = Array.from({ length: 3 }, () => randomUUID());
  const checkIds = clientIds.map(() => randomUUID());
  const callIds = checkIds.map((id) => `mock_acoustic_${id}`);
  const texts = [
    "I am calm, but the water is rising and I am trapped upstairs.",
    "I am okay and I have food and water at the shelter.",
    "I would like to talk with someone about what happened.",
  ];
  const priorities = texts.map((text, index) => assessCallerPriority({ call_id: callIds[index],
    transcript_object: [{ role: "user", content: text }] }, { mode: "crisis" }));
  const assertions: string[] = [];
  const observations: { scenario: string; priority?: string; status?: string; result: string }[] = [];
  const makeAcoustic = (index: number, signal: AcousticAnalysis["signal"], status?: AcousticAnalysis["status"]): AcousticAssessment => ({
    call_id: callIds[index], source: "local_test", analyzed_at: "2026-10-17T00:00:00.000Z", result: syntheticAnalysis(signal, status),
  });
  const read = async (index: number): Promise<Check> => {
    const result = await db.from("checks").select("*").eq("id", checkIds[index]).single();
    if (result.error) throw new Error(result.error.message);
    return result.data as Check;
  };
  const apply = async (index: number, acoustic: AcousticAssessment, priority: CallerAssessment,
    overrides: { callId?: string; target?: CallTarget } = {}): Promise<ApplyResult> => {
    const result = await db.rpc("apply_heartbeat_acoustic", {
      p_check_id: checkIds[index], p_call_id: overrides.callId ?? callIds[index], p_target: overrides.target ?? "client",
      p_acoustic: acoustic, p_priority: priority,
    });
    if (result.error) throw new Error(result.error.message);
    return result.data as ApplyResult;
  };
  let status = "failed";
  let failure: string | undefined;
  const cleanupErrors: string[] = [];
  try {
    // A fresh random UUID proves RPC availability without touching an existing check.
    const probe = await db.rpc("apply_heartbeat_acoustic", {
      p_check_id: randomUUID(), p_call_id: "mock_acoustic_schema_probe", p_target: "client",
      p_acoustic: makeAcoustic(0, "uncertain"), p_priority: priorities[0],
    });
    if (probe.error) throw new Error(`Acoustic migration is not available or its RPC failed: ${probe.error.message}`);
    assert.equal((probe.data as ApplyResult).skipped, "unknown");
    const clients = await db.from("clients").insert(clientIds.map((id, index) => ({
      id, name: ["Fictional acoustic · Calm danger", "Fictional acoustic · Routine", "Fictional acoustic · Unknown"][index],
      phone: `+1202555011${index}`, emergency_contact_name: "Fictional contact", emergency_contact_phone: "+12025550119",
      risk_tier: "green", lives_alone: false, uses_powered_equipment: false,
    })));
    if (clients.error) throw new Error(clients.error.message);
    const event = await db.from("events").insert({ id: eventId, type: "crisis",
      alert_text: "FICTIONAL ACOUSTIC PERSISTENCE TEST. Synthetic model responses; no live call, disaster, or dispatch." });
    if (event.error) throw new Error(event.error.message);
    const checks = await db.from("checks").insert(checkIds.map((id, index) => ({ id, event_id: eventId, client_id: clientIds[index],
      status: index === 0 ? "needs_human" : index === 1 ? "ok" : "calling", urgency: index === 0 ? "urgent" : null,
      ladder_step: 0, last_call_id: callIds[index], priority_call_id: callIds[index], priority_assessment: priorities[index] })));
    if (checks.error) throw new Error(checks.error.message);

    const uncertain = makeAcoustic(0, "uncertain");
    const calmPriority = combineAcousticPriority(priorities[0], uncertain.result);
    const calmResult = await apply(0, uncertain, calmPriority);
    assert.equal(calmResult.applied, true);
    const calm = await read(0);
    assert.equal(calm.priority_assessment?.priority, "immediate");
    assert.equal(calm.status, "needs_human");
    assert.equal(calm.urgency, "urgent");
    observations.push({ scenario: "Calm reported danger with uncertain acoustic fixture", priority: calm.priority_assessment?.priority,
      status: calm.status, result: "preserved" });
    assertions.push("Uncertain audio cannot lower immediate review of a reported threat.");

    const elevatedRoutine = makeAcoustic(1, "elevated");
    const routinePriority = combineAcousticPriority(priorities[1], elevatedRoutine.result);
    const routineResult = await apply(1, elevatedRoutine, routinePriority);
    assert.equal(routineResult.applied, true);
    const routine = await read(1);
    assert.equal(routine.priority_assessment?.priority, "review");
    assert.equal(routine.status, "needs_human");
    assert.notEqual(routine.priority_assessment?.situation, "immediate_danger");
    observations.push({ scenario: "Routine circumstances with elevated acoustic fixture", priority: routine.priority_assessment?.priority,
      status: routine.status, result: "operator review, not an immediate-danger label" });
    assertions.push("Elevated acoustic output with routine reported circumstances requests human review without manufacturing an immediate threat.");
    const staleLowerPriority = await apply(1, elevatedRoutine, { ...routinePriority, priority: "follow_up" });
    assert.notEqual(staleLowerPriority.newly_escalated, true);
    const reviewProtected = await read(1);
    assert.equal(reviewProtected.priority_assessment?.priority, "review");
    assert.equal(reviewProtected.status, "needs_human");
    assertions.push("An older lower-priority assessment cannot downgrade an existing review-level concern.");

    const elevatedUnknown = makeAcoustic(2, "elevated");
    const unknownPriority = combineAcousticPriority(priorities[2], elevatedUnknown.result);
    const unknownResult = await apply(2, elevatedUnknown, unknownPriority);
    assert.equal(unknownResult.applied, true);
    assert.equal(unknownResult.newly_escalated, true);
    const unknown = await read(2);
    assert.equal(unknown.priority_assessment?.priority, "review");
    assert.equal(unknown.priority_assessment?.situation, "unknown");
    assert.equal(unknown.status, "needs_human");
    assert.equal(unknown.urgency, "follow_up");
    observations.push({ scenario: "Unknown circumstances with elevated acoustic fixture", priority: unknown.priority_assessment?.priority,
      status: unknown.status, result: "human clarification without changing reported severity" });
    assertions.push("Elevated audio with unknown circumstances requests human review without promoting reported severity.");

    const duplicate = await apply(2, elevatedUnknown, unknownPriority);
    assert.equal(duplicate.duplicate, true);
    assert.notEqual(duplicate.newly_escalated, true);
    assert.deepEqual(await read(2), unknown);
    const timestampRetry = await apply(2, { ...elevatedUnknown, analyzed_at: "2026-10-17T00:01:00.000Z" }, unknownPriority);
    assert.equal(timestampRetry.duplicate, true);
    assert.deepEqual(await read(2), unknown);
    assertions.push("Identical evidence, including a retry with a different processing timestamp, does not write the check or produce another escalation.");

    const uncertainRetry = makeAcoustic(2, "uncertain");
    const retainedElevated = await apply(2, uncertainRetry, combineAcousticPriority(priorities[2], uncertainRetry.result));
    assert.equal(retainedElevated.skipped, "elevated_result_retained");
    assert.deepEqual(await read(2), unknown);
    assertions.push("An uncertain retry cannot overwrite an elevated result already recorded for the same call.");

    const unavailable = makeAcoustic(2, "uncertain", "unavailable");
    const failedPriority = combineAcousticPriority(priorities[2], unavailable.result);
    const failed = await apply(2, unavailable, failedPriority);
    assert.notEqual(failed.applied, true);
    assert.deepEqual(await read(2), unknown);
    assertions.push("An unavailable model response cannot replace an existing available acoustic assessment.");

    const stale = await apply(2, elevatedUnknown, unknownPriority, { callId: `mock_stale_${randomUUID()}` });
    assert.equal(stale.skipped, "stale_call");
    assert.deepEqual(await read(2), unknown);
    const wrongTarget = await apply(2, elevatedUnknown, unknownPriority, { target: "emergency_contact" });
    assert.equal(wrongTarget.skipped, "wrong_target");
    assert.deepEqual(await read(2), unknown);
    assertions.push("Old call IDs and incorrect caller targets cannot update the current check.");

    const handled = await db.from("checks").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", checkIds[2]);
    if (handled.error) throw new Error(handled.error.message);
    const handledBefore = await read(2);
    const protectedResult = await apply(2, elevatedUnknown, { ...unknownPriority, priority: "immediate" });
    assert.equal(protectedResult.skipped, "handled");
    assert.deepEqual(await read(2), handledBefore);
    assertions.push("Human-handled checks remain unchanged by later acoustic callbacks.");
    status = "passed";
  } catch (error) {
    failure = error instanceof Error ? error.message : "Acoustic persistence verification failed";
  } finally {
    // Cleanup is limited to UUIDs created by this run, including partial setup.
    const checks = await db.from("checks").delete().in("id", checkIds);
    if (checks.error) cleanupErrors.push(`checks: ${checks.error.message}`);
    const event = await db.from("events").delete().eq("id", eventId);
    if (event.error) cleanupErrors.push(`event: ${event.error.message}`);
    const clients = await db.from("clients").delete().in("id", clientIds);
    if (clients.error) cleanupErrors.push(`clients: ${clients.error.message}`);
    if (cleanupErrors.length) status = "failed";
    const report = { status, mode: "real local PostgreSQL RPC with synthetic model-response fixtures",
      liveRetellVerified: false, acousticModelAccuracyVerified: false,
      limitation: "This verifies persistence and priority policy only; it does not measure emotion accuracy or verify live Retell audio.",
      assertions, observations, fixturesCleanedUp: cleanupErrors.length === 0, ...(failure ? { failure } : {}),
      ...(cleanupErrors.length ? { cleanupErrors } : {}) };
    mkdirSync("output/caller-priority", { recursive: true });
    writeFileSync("output/caller-priority/acoustic-persistence.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
  if (status !== "passed") throw new Error(failure ?? "Acoustic verification cleanup failed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Acoustic persistence verification failed");
  process.exitCode = 1;
});
