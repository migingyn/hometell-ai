// Isolated local simulation: no global campaign start, calls, texts, or resets.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../lib/supabase";
import type { CheckWithClient } from "../lib/types";

const base = new URL(process.env.DISASTER_DEMO_APP_URL ?? "http://127.0.0.1:3018");
const keep = process.argv.includes("--keep");
const sessionId = randomUUID();
const assertions: string[] = [];
type State = { sessionId: string; eventId: string; dailyEventId: string; step: number; totalSteps: number; done: boolean; simulated: boolean; focusClientId: string };
async function request(path: string, body?: unknown) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "error", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000) });
  return { status: response.status, json: await response.json() };
}
async function replay(body: unknown): Promise<State> {
  const response = await request("/api/demo/disaster", body);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.ok, true);
  return response.json.data as State;
}
async function checks(eventId: string) {
  const { data, error } = await supabaseAdmin().from("checks").select("*,client:clients(*)").eq("event_id", eventId);
  assert.equal(error, null);
  return data as CheckWithClient[];
}
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--keep")) throw new Error("Usage: npx tsx scripts/verify-disaster-demo.ts [--keep]");
  const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  for (const url of [base, database]) assert.ok(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(process.env.MOCK_RETELL, "true");
  const db = supabaseAdmin();
  const { data: before } = await db.from("checks").select("id,updated_at");
  let eventId: string | null = null;
  let patientIds: string[] = [];
  let complete = false;
  try {
    const first = await replay({ action: "start", sessionId });
    eventId = first.eventId;
    assert.equal(first.step, -1);
    assert.equal(first.totalSteps, 6);
    assert.equal(first.simulated, true);
    assert.deepEqual(await replay({ action: "start", sessionId }), first);
    let rows = await checks(eventId);
    assert.equal(rows.length, 20);
    patientIds = rows.map((row) => row.client_id);
    const dailyRows = await checks(first.dailyEventId);
    assert.equal(dailyRows.length, 20);
    assert.deepEqual(new Set(dailyRows.map((row) => row.client_id)), new Set(patientIds));
    assert.ok(rows.every((row) => row.status === "queued" && row.next_action_at === null));
    assert.ok(rows.every((row) => row.client.phone.startsWith("+120255501")));
    const prior = await request(`/api/checks/${rows[0].id}/evidence`);
    assert.equal(prior.json.data.source, "none");
    assert.ok(prior.json.data.priorDaily?.rideQuote);
    assert.equal(Object.keys(prior.json.data.priorDaily.answers).length, 8);
    assertions.push("Start is idempotent; exactly twenty fictional patients have saved prior care and ride evidence.");
    assert.equal((await request("/api/demo/disaster", { action: "step", sessionId, eventId, step: 2 })).status, 409);
    assert.equal((await request("/api/demo/disaster", { action: "step", sessionId, eventId: randomUUID(), step: 0 })).status, 404);
    assertions.push("Out-of-order steps and an arbitrary event ID are rejected.");
    for (let step = 0; step < 6; step++) {
      const state = await replay({ action: "step", sessionId, eventId, step });
      assert.equal(state.step, step);
      assert.equal(state.dailyEventId, first.dailyEventId);
      assert.ok(patientIds.includes(state.focusClientId));
      assert.deepEqual(await replay({ action: "step", sessionId, eventId, step }), state);
      rows = await checks(eventId);
      assert.ok(rows.every((row) => row.next_action_at === null), "Global ladder cannot advance replay checks.");
      if (step === 1) {
        const severe = rows.find((row) => row.client.name === "Evelyn Brooks")!;
        const distressed = rows.find((row) => row.client.name === "Marcus Reed")!;
        assert.equal(severe.priority_assessment?.priority, "immediate");
        assert.equal(severe.priority_assessment?.situation, "immediate_danger");
        assert.equal(distressed.priority_assessment?.distress, "high");
        assert.equal(distressed.priority_assessment?.priority, "follow_up");
        const evidence = await request(`/api/checks/${severe.id}/evidence`);
        assert.equal(evidence.json.data.callId, severe.last_call_id);
        assert.equal(evidence.json.data.source, "persisted_call_log");
        assert.ok(evidence.json.data.turns.some((turn: { role: string; content: string }) => turn.role === "user" && turn.content.includes("bleeding heavily")));
        assert.equal(evidence.json.data.simulated, true);
        assert.equal("raw" in evidence.json.data, false);
      }
      if (step === 4) {
        const contact = rows.find((row) => row.client.name === "Harold Chen")!;
        assert.equal(contact.ladder_step, 3);
        assert.equal(contact.status, "calling");
      }
    }
    assertions.push("All six persistent steps are idempotent; calm immediate danger outranks a distressed caller at shelter.");
    const final = await replay({ action: "status", sessionId, eventId });
    assert.equal(final.done, true);
    const unreachable = rows.find((row) => row.client.name === "Harold Chen")!;
    const handoff = rows.find((row) => row.client.name === "Evelyn Brooks")!;
    assert.equal(unreachable.status, "needs_human");
    assert.equal(unreachable.flag_reason, "unreachable");
    assert.equal(unreachable.ladder_step, 4);
    assert.equal(handoff.nurse_transfer?.status, "connected");
    assert.equal(handoff.status, "needs_human");
    assert.ok(rows.every(row => !["queued", "calling"].includes(row.status)), "Every fictional resident has an explicit outcome; no phantom calls remain live.");
    assert.ok(rows.every((row) => row.handled_at === null), "The AI never resolves or dispatches care.");
    assertions.push("Final state retains unreachable and human-handoff needs; nobody is marked handled or dispatched.");
    if (before?.length) {
      // Bound the filter size so an accumulated local fixture database cannot
      // exceed the HTTP URL limit and masquerade as missing records.
      for (let offset = 0; offset < before.length; offset += 50) {
        const batch: { id: string; updated_at: string }[] = before.slice(offset, offset + 50);
        const { data: after, error: readError } = await db.from("checks").select("id,updated_at").in("id", batch.map(row => row.id));
        assert.equal(readError, null, "Existing records must remain readable.");
        const unchanged = new Map(after?.map(row => [row.id, row.updated_at]));
        assert.equal(unchanged.size, batch.length, "An existing record disappeared.");
        for (const row of batch) assert.equal(unchanged.get(row.id), row.updated_at, "An existing record changed during this isolated verification.");
      }
    }
    assertions.push("Checks that existed before this replay remain untouched.");
    complete = true;
  } finally {
    if (!(complete && keep)) {
      const { data: owned } = await db.from("clients").select("id").eq("emergency_contact_name", `Fictional replay contact [${sessionId}]`);
      patientIds = owned?.map((row) => row.id) ?? patientIds;
      const { data: ownedEvents } = await db.from("events").select("id").like("alert_text", `SIMULATED DISASTER REPLAY [${sessionId}]%`);
      if (ownedEvents?.length) await db.from("events").delete().in("id", ownedEvents.map((event) => event.id));
      if (patientIds.length) await db.from("clients").delete().in("id", patientIds).eq("emergency_contact_name", `Fictional replay contact [${sessionId}]`);
    }
  }
  await mkdir(resolve("output/disaster-demo"), { recursive: true });
  await writeFile(resolve("output/disaster-demo/verification.json"), JSON.stringify({ completedAt: new Date().toISOString(), passed: complete,
    mode: "SIMULATED", outboundCallsPlaced: false, outboundTextsSent: false, sessionId, eventId, retained: keep, assertions }, null, 2));
  console.log(`Disaster replay verification passed (${assertions.length} scenario groups). ${keep ? "Simulation retained." : "Only this run's fixtures cleaned up."}`);
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Disaster replay verification failed."); process.exitCode = 1; });
