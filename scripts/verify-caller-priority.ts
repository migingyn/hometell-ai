// Real local HTTP + PostgreSQL verification with explicitly fictional calls.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { analyzeAudio } from "../lib/acoustic/client";
import { combineAcousticPriority } from "../lib/acoustic/policy";
import type { AcousticAssessment } from "../lib/acoustic/types";
import { supabaseAdmin } from "../lib/supabase";
import type { ApiResult, Check, RetellCall } from "../lib/types";

async function main() {
  const base = new URL(process.env.CALLER_PRIORITY_APP_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3017");
  if (process.env.MOCK_RETELL !== "true" || !["localhost", "127.0.0.1"].includes(base.hostname) ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1:55321")) {
    throw new Error("Priority verification requires this project's local database and MOCK_RETELL=true. Nothing was changed.");
  }
  const health = await fetch(new URL("/api/health", base)).then((r) => r.json()) as ApiResult<{ mockMode: boolean }>;
  assert.ok(health.ok && health.data.mockMode, "The running app must also be in mock mode.");
  const db = supabaseAdmin();
  const eventId = randomUUID();
  const clientIds = [randomUUID(), randomUUID(), randomUUID()];
  const checkIds = [randomUUID(), randomUUID(), randomUUID()];
  const callIds = checkIds.map((id) => `mock_priority_${id}`);
  const quotes = [
    "I am staying calm. Water is rising inside my house and I am trapped upstairs.",
    "I am panicking, but I am in a shelter and I have food and water.",
    "I am okay and I have food and water.",
  ];
  const assertions: string[] = [];
  let passed = false;
  const expect = async (id: string) => {
    const result = await db.from("checks").select("*").eq("id", id).single();
    if (result.error) throw new Error(result.error.message);
    return result.data as Check;
  };
  const send = async (event: string, index: number, changes: Partial<RetellCall> = {}) => {
    const call: RetellCall = { call_id: callIds[index], metadata: { check_id: checkIds[index], target: "client", mode: "crisis" },
      transcript: `User: ${quotes[index]}`, transcript_object: [{ role: "user", content: quotes[index] }], ...changes };
    const response = await fetch(new URL("/api/retell/webhook", base), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event, call }),
    });
    const result = await response.json() as ApiResult<unknown>;
    assert.ok(response.ok && result.ok, `Simulated ${event} callback failed (HTTP ${response.status}).`);
    return result;
  };
  try {
    const clients = await db.from("clients").insert(clientIds.map((id, index) => ({
      id, name: ["Fictional · Calm danger", "Fictional · Reported panic", "Fictional · Routine check-in"][index],
      phone: `+1202555010${index}`, emergency_contact_name: "Fictional contact", emergency_contact_phone: "+12025550109",
      risk_tier: index === 0 ? "green" : "red", lives_alone: false, uses_powered_equipment: false,
    })));
    if (clients.error) throw new Error(clients.error.message);
    const event = await db.from("events").insert({ id: eventId, type: "crisis", alert_text: "FICTIONAL PRIORITY DEMONSTRATION. No disaster, live phone call, or emergency dispatch." });
    if (event.error) throw new Error(event.error.message);
    const checks = await db.from("checks").insert(checkIds.map((id, index) => ({ id, event_id: eventId, client_id: clientIds[index], status: "calling", last_call_id: callIds[index] })));
    if (checks.error) throw new Error(checks.error.message);
    for (let i = 0; i < 3; i++) await send("transcript_updated", i);
    assert.equal((await expect(checkIds[0])).priority_assessment?.priority, "immediate");
    assert.equal((await expect(checkIds[1])).priority_assessment?.priority, "follow_up");
    assert.equal((await expect(checkIds[2])).status, "calling");
    assertions.push("Calm reported danger receives immediate review; panic does not raise routine reported severity; routine speech does not establish a completed check-in.");

    const before = await expect(checkIds[0]);
    await send("transcript_updated", 0);
    assert.equal((await expect(checkIds[0])).updated_at, before.updated_at);
    assertions.push("Repeated transcript snapshots do not rewrite the record or re-alert.");

    await send("transcript_updated", 0, { transcript_object: [], transcript: "" });
    assert.equal((await expect(checkIds[0])).updated_at, before.updated_at);
    await send("transcript_updated", 0, { call_id: "mock_old_call" });
    assert.equal((await expect(checkIds[0])).updated_at, before.updated_at);
    assertions.push("Older snapshots and old call IDs cannot clear a danger report.");

    const positive = { transcript: "User: I am okay.", transcript_object: [{ role: "user", content: "I am okay." }],
      call_analysis: { user_sentiment: "Positive", call_summary: "Later positive words do not clear the earlier reported danger.", custom_analysis_data: { client_status: "ok" } } };
    await send("call_analyzed", 0, positive);
    const finalized = await expect(checkIds[0]);
    assert.equal(finalized.status, "needs_human");
    assert.equal(finalized.priority_assessment?.priority, "immediate");
    await send("call_analyzed", 0, positive);
    assert.equal((await expect(checkIds[0])).updated_at, finalized.updated_at);
    await send("transcript_updated", 0);
    assert.equal((await expect(checkIds[0])).updated_at, finalized.updated_at);
    assertions.push("Final analysis preserves the peak concern, commits once, and rejects late live snapshots.");

    const handled = await db.from("checks").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", checkIds[2]);
    if (handled.error) throw new Error(handled.error.message);
    await send("transcript_updated", 2, { transcript_object: [{ role: "user", content: quotes[0] }] });
    assert.equal((await expect(checkIds[2])).status, "handled");
    assertions.push("A human-handled record cannot be reopened by automated callbacks.");

    const logs = await db.from("call_logs").select("id", { count: "exact", head: true }).eq("retell_call_id", callIds[0]);
    assert.equal(logs.count, 1);
    let acousticAnalysis = "not exercised by this transcript simulation";
    if (process.argv.includes("--with-audio")) {
      const fixtures = ["NEU", "FEA"];
      for (let i = 0; i < fixtures.length; i++) {
        const file = `services/acoustic-analysis/fixtures-local/smoke-repeated-1001_DFA_${fixtures[i]}_XX.wav`;
        const analysis = await analyzeAudio(readFileSync(file), [], 0);
        assert.equal(analysis.status, "available", "Public acted-speech fixture must reach the real local model.");
        const previous = await expect(checkIds[i]);
        assert.ok(previous.priority_assessment);
        const acoustic: AcousticAssessment = { call_id: callIds[i], source: "local_test", analyzed_at: new Date().toISOString(), result: analysis };
        const { data, error } = await db.rpc("apply_heartbeat_acoustic", {
          p_check_id: checkIds[i], p_call_id: callIds[i], p_target: "client", p_acoustic: acoustic,
          p_priority: combineAcousticPriority(previous.priority_assessment, analysis),
        });
        assert.ifError(error);
        assert.equal(data?.applied, true);
        assert.equal(data.check.priority_assessment.priority, i === 0 ? "immediate" : analysis.signal === "elevated" ? "review" : "follow_up");
        const updated = await db.from("checks").update({ summary: "Fictional text scenario with separate public acted-speech audio for the local model test. No real caller." }).eq("id", checkIds[i]);
        assert.ifError(updated.error);
      }
      acousticAnalysis = "Real self-hosted model inference on separate public acted-speech fixtures; not a real Retell call or accuracy validation.";
      assertions.push("Actual audio upload, pinned-model output validation, priority combination, and database storage succeed; neutral/uncertain expression cannot lower the danger report.");
    }
    const report = { mode: "explicit local simulation", liveRetellVerified: false, acousticAnalysis, acousticModelAccuracyVerified: false, assertions };
    mkdirSync("output/caller-priority", { recursive: true });
    writeFileSync("output/caller-priority/verification.json", JSON.stringify(report, null, 2));
    passed = true;
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes("--keep")) console.log("Fictional priority examples kept on the local dashboard.");
  } finally {
    if (!passed || !process.argv.includes("--keep")) {
      await db.from("events").delete().eq("id", eventId);
      await db.from("clients").delete().in("id", clientIds);
    }
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Priority verification failed"); process.exitCode = 1; });
