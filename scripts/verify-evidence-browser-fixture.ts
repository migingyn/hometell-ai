// Clearly labeled local fixtures for browser verification. Never places a call.
import "./env";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supabaseAdmin } from "../lib/supabase";
import { buildFakeWebhook } from "./fake-webhook";

const base = new URL("http://127.0.0.1:3018");
const path = resolve("output/evidence-review/browser-fixture.json");
const name = "Jordan Lee · verification sample";
type Fixture = { clientId: string; eventId: string; checkId: string; callId: string };
const db = supabaseAdmin();

async function readFixture(): Promise<Fixture> {
  const fixture = JSON.parse(await readFile(path, "utf8")) as Fixture;
  assert.match(fixture.callId, /^call_evidence_browser_[a-f0-9-]{36}$/);
  for (const id of [fixture.clientId, fixture.eventId, fixture.checkId]) assert.match(id, /^[a-f0-9-]{36}$/);
  const row = await db.from("checks").select("client_id,event_id,last_call_id,client:clients(name)").eq("id", fixture.checkId).single();
  assert.equal(row.error, null);
  assert.equal(row.data?.client_id, fixture.clientId);
  assert.equal(row.data?.event_id, fixture.eventId);
  assert.equal(row.data?.last_call_id, fixture.callId);
  assert.equal((row.data?.client as unknown as { name: string })?.name, name);
  return fixture;
}

async function callback(fixture: Fixture, stage: "start" | "more" | "complete") {
  const payload = buildFakeWebhook({ id: fixture.checkId, last_call_id: fixture.callId,
    client: { name, emergency_contact_name: "Fictional contact" } }, "ok", "client", "daily");
  if (stage !== "complete") {
    payload.event = "transcript_updated";
    payload.call.call_status = "ongoing";
    delete payload.call.disconnection_reason;
    delete payload.call.call_analysis;
    payload.call.transcript_object = payload.call.transcript_object!.slice(0, stage === "start" ? 2 : 6);
    payload.call.transcript = payload.call.transcript_object.map(turn => `${turn.role === "user" ? "User" : "Agent"}: ${turn.content}`).join("\n");
  }
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const key = process.env.RETELL_WEBHOOK_KEY?.trim() || process.env.RETELL_API_KEY?.trim();
  assert.ok(key);
  const signature = `v=${timestamp},d=${createHmac("sha256", key).update(body + timestamp).digest("hex")}`;
  const response = await fetch(new URL("/api/retell/webhook", base), {
    method: "POST", headers: { "Content-Type": "application/json", "x-retell-signature": signature },
    body, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
  console.log(`Fictional ${stage} callback saved; no telephone request was made.`);
}

async function main() {
  const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  assert.equal(database.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(process.env.MOCK_RETELL, "true");
  const health = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(10_000) }).then(r => r.json());
  assert.equal(health.data?.mockMode, true, "The server must remain in global mock mode.");
  const action = process.argv[2];
  assert.ok(["start", "more", "complete", "change-source", "cleanup"].includes(action), "Use start, more, complete, change-source, or cleanup.");
  if (action === "start") {
    await assert.rejects(readFile(path), { code: "ENOENT" }, "Clean up the existing fixture before creating another.");
    const fixture: Fixture = { clientId: randomUUID(), eventId: randomUUID(), checkId: randomUUID(), callId: `call_evidence_browser_${randomUUID()}` };
    await mkdir(resolve("output/evidence-review"), { recursive: true });
    const client = await db.from("clients").insert({ id: fixture.clientId, name, phone: "+12025550180", risk_tier: "yellow",
      lives_alone: true, uses_powered_equipment: false, emergency_contact_name: "Fictional contact", emergency_contact_phone: "+12025550181",
      lat: 34.1903, lng: -118.1486 });
    assert.equal(client.error, null);
    const event = await db.from("events").insert({ id: fixture.eventId, type: "daily", started_at: new Date().toISOString(),
      alert_text: "SIMULATED DISASTER REPLAY · local evidence workflow verification; no calls placed" });
    assert.equal(event.error, null);
    const check = await db.from("checks").insert({ id: fixture.checkId, client_id: fixture.clientId, event_id: fixture.eventId,
      status: "calling", ladder_step: 0, last_call_id: fixture.callId, next_action_at: null,
      summary: "SIMULATED: Browser verification of a streaming transcript." });
    assert.equal(check.error, null);
    await writeFile(path, JSON.stringify(fixture, null, 2));
    await callback(fixture, "start");
    return;
  }
  const fixture = await readFixture();
  if (action === "change-source") {
    const current = await db.from("checks").select("postop_assessment").eq("id", fixture.checkId).single();
    assert.equal(current.error, null);
    assert.ok(current.data?.postop_assessment);
    const assessment = structuredClone(current.data.postop_assessment);
    assessment.answers.pain = { status: "unknown", value: null, quote: null };
    const changed = await db.from("checks").update({ postop_assessment: assessment })
      .eq("id", fixture.checkId).eq("last_call_id", fixture.callId);
    assert.equal(changed.error, null);
    console.log("Only the fictional extraction changed, to verify that an open correction becomes stale.");
    return;
  }
  if (action === "cleanup") {
    const event = await db.from("events").delete().eq("id", fixture.eventId);
    assert.equal(event.error, null);
    const client = await db.from("clients").delete().eq("id", fixture.clientId).eq("name", name);
    assert.equal(client.error, null);
    await unlink(path);
    console.log("Only this browser verification's fictional records were removed.");
    return;
  }
  await callback(fixture, action as "more" | "complete");
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Fixture verification failed."); process.exitCode = 1; });
