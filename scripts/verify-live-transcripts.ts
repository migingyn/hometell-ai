// Synthetic signed callbacks + isolated local database fixtures. Never starts a call.
// Usage: npx tsx scripts/verify-live-transcripts.ts [--keep]
import "./env";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabase";
import type { RetellCall } from "../lib/types";
import { POST as webhookHandler } from "../app/api/retell/webhook/route";

const base = new URL(process.env.TRANSCRIPT_APP_URL ?? "http://127.0.0.1:3018");
const keep = process.argv.includes("--keep");
const db = supabaseAdmin();
const clientId = randomUUID(), eventId = randomUUID(), checkId = randomUUID(), contactCheckId = randomUUID(), contactEventId = randomUUID();
const callId = `call_transcript_fixture_${randomUUID()}`, contactCallId = `call_transcript_fixture_${randomUUID()}`;
const assertions: string[] = [];
const local = (url: URL) => url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && !url.username && !url.password;
const turns = [
  { role: "agent", content: "This is a fictional test check-in. How are you?", words: [{ start: 0, end: 3 }] },
  { role: "user", content: "My pain is 3 out of 10. My phone is +1 (202) 555-0199.", words: [{ start: 4, end: 8 }] },
];
const call: RetellCall = { call_id: callId, call_status: "ongoing", metadata: { check_id: checkId, target: "client", mode: "daily" }, transcript_object: turns };

function callbackRequest(event: string, supplied: RetellCall, signed = true) {
  const raw = JSON.stringify({ event, call: supplied }), stamp = Date.now();
  const key = process.env.RETELL_WEBHOOK_KEY?.trim() || process.env.RETELL_API_KEY!.trim();
  const signature = `v=${stamp},d=${createHmac("sha256", key).update(raw + stamp).digest("hex")}`;
  return new Request(new URL("/api/retell/webhook", base), { method: "POST", body: raw, redirect: "error",
    headers: { "Content-Type": "application/json", ...(signed ? { "x-retell-signature": signature } : {}) }, signal: AbortSignal.timeout(30_000) });
}
async function callback(event: string, supplied: RetellCall = call, signed = true) {
  const response = await fetch(callbackRequest(event, supplied, signed));
  const json = await response.json();
  return { status: response.status, data: json.data, error: json.error };
}

async function accepted(event: string, supplied = call) {
  const response = await callback(event, supplied);
  assert.equal(response.status, 200, `Synthetic ${event} callback failed: ${response.error ?? response.status}`);
  return response.data;
}

async function evidence(id = checkId) {
  const response = await fetch(new URL(`/api/checks/${id}/evidence`, base), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  return (await response.json()).data;
}

async function main() {
  assert.ok(local(base) && local(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)) && process.env.MOCK_RETELL === "true", "Requires a local mock app/database; no fixtures created.");
  assert.ok(process.env.RETELL_WEBHOOK_KEY || process.env.RETELL_API_KEY, "Signing key required.");
  assert.ok(process.argv.slice(2).every((arg) => arg === "--keep"));
  const health = await fetch(new URL("/api/health", base));
  const healthy = (await health.json()).data;
  assert.ok(healthy?.database && healthy?.mockMode, "Running app must use the local mock transport.");
  const schema = await db.from("heartbeat_call_transcripts").select("call_id").limit(1);
  assert.equal(schema.error, null, "Apply migration 011 before verification; no fixtures created.");
  let passed = false;
  try {
    assert.equal((await db.from("clients").insert({ id: clientId, name: "Fictional live-transcript verification", phone: "+12025550199",
      risk_tier: "green", lives_alone: false, uses_powered_equipment: false, emergency_contact_name: "Fictional contact", emergency_contact_phone: "+12025550198" })).error, null);
    assert.equal((await db.from("events").insert([{ id: eventId, type: "daily", alert_text: "FICTIONAL signed callback verification; no telephone call placed." },
      { id: contactEventId, type: "crisis", alert_text: "FICTIONAL contact callback verification; no telephone call placed." }])).error, null);
    assert.equal((await db.from("checks").insert([
      { id: checkId, client_id: clientId, event_id: eventId, status: "calling", last_call_id: callId, ladder_step: 0 },
      { id: contactCheckId, client_id: clientId, event_id: contactEventId, status: "calling", last_call_id: contactCallId, ladder_step: 3 },
    ])).error, null);
    assert.equal((await callback("transcript_updated", call, false)).status, 401);
    assert.equal((await accepted("transcript_updated", { ...call, metadata: { ...call.metadata!, target: "emergency_contact" } })).skipped, "wrong_target");
    await accepted("call_started", { ...call, transcript_object: [] });
    assert.equal((await evidence()).callStatus, "ongoing");
    // Exercise the real handler while intercepting only this process's one
    // local priority write. The database function/server remain unchanged.
    const firstPartial = { ...call, transcript_object: [turns[0]] };
    const realFetch = globalThis.fetch;
    let injected = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (local(url) && url.pathname.endsWith("/rpc/apply_heartbeat_priority") && injected === 0) {
        injected++;
        return Response.json({ code: "FIXTURE_FAILURE", message: "Synthetic one-shot failure" }, { status: 400 });
      }
      return realFetch(input, init);
    };
    try { assert.equal((await webhookHandler(callbackRequest("transcript_updated", firstPartial))).status, 500); }
    finally { globalThis.fetch = realFetch; }
    assert.equal(injected, 1);
    const pendingPriority = await db.from("checks").select("priority_call_id").eq("id", checkId).single();
    assert.equal(pendingPriority.data?.priority_call_id, null);
    assert.equal((await evidence()).turns.length, 1);
    await accepted("transcript_updated", firstPartial);
    const savedPriority = await db.from("checks").select("priority_call_id").eq("id", checkId).single();
    assert.equal(savedPriority.data?.priority_call_id, callId);
    assertions.push("An exact callback retry repairs a priority-write failure after the transcript already committed.");
    await accepted("transcript_updated");
    let result = await evidence();
    assert.equal(result.source, "live_call");
    assert.equal(result.callKind, "agency_call");
    assert.equal(result.simulated, false);
    assert.equal(result.turns.length, 2);
    assert.equal(result.turns[1].content.includes("555"), false);
    assert.equal(result.turns[1].id, `${callId}:turn:1`);
    assert.equal((await db.from("call_logs").select("id").eq("retell_call_id", callId)).data?.length, 0);
    assertions.push("Signed real-ID callbacks required during mock mode; correct binding, no-cache redacted full turns, and no interim final log.");

    const longer = { ...call, transcript_object: [turns[0], { ...turns[1], content: `${turns[1].content} I ate breakfast.`, words: [{ start: 4, end: 10 }] }] };
    await accepted("transcript_updated", longer);
    await accepted("transcript_updated", call);
    await accepted("transcript_updated", { ...call, transcript_object: [turns[0]] });
    assert.equal((await evidence()).turns[1].content.endsWith("I ate breakfast."), true);
    const undated = { ...longer, transcript_object: longer.transcript_object.map(({ role, content }) => ({ role, content })) };
    await accepted("transcript_updated", { ...undated, transcript_object: [undated.transcript_object[0], { role: "user", content: `${undated.transcript_object[1].content} And lunch.` }] });
    assert.equal((await evidence()).turns[1].content.endsWith("And lunch."), true);
    assertions.push("Cumulative within-turn updates advance, while shorter and older timed callbacks cannot regress the transcript.");

    await accepted("call_ended", { ...call, call_status: "ended", transcript_object: [] });
    result = await evidence();
    assert.equal(result.callStatus, "ended");
    assert.equal(result.turns.length, 2);
    await accepted("transcript_updated", { ...call, transcript_object: [...turns, { role: "user", content: "Late live event must not reopen this call." }] });
    assert.equal((await evidence()).callStatus, "ended");
    assert.equal((await evidence()).turns.length, 2);
    assert.equal((await db.from("call_logs").select("id").eq("retell_call_id", callId)).data?.length, 0);
    const final: RetellCall = { ...call, call_status: "ended", disconnection_reason: "agent_hangup",
      transcript_object: [...turns, { role: "user", content: "I ate breakfast and lunch today.", words: [{ start: 11, end: 13 }] }],
      call_analysis: { call_summary: "Fictional verification: patient-reported check-in awaits review.", custom_analysis_data: { client_status: "ok", postop_patient_confirmed: false } } };
    await Promise.all([accepted("call_analyzed", final), accepted("call_analyzed", final)]);
    result = await evidence();
    assert.equal(result.callStatus, "analyzed");
    assert.equal(result.turns.length, 3);
    assert.equal((await db.from("call_logs").select("id").eq("retell_call_id", callId)).data?.length, 1);
    await accepted("transcript_updated", { ...final, transcript_object: [...final.transcript_object!, { role: "user", content: "Late event" }] });
    await accepted("call_ended", call);
    assert.equal((await evidence()).turns.length, 3);
    assert.equal((await evidence()).callStatus, "analyzed");
    assertions.push("End does not consume analysis; concurrent final callbacks create one final log, and late live/end events cannot overwrite final evidence.");

    const contact = { ...call, call_id: contactCallId, metadata: { check_id: contactCheckId, target: "emergency_contact" as const, mode: "crisis" as const } };
    await accepted("transcript_updated", contact);
    assert.equal((await evidence(contactCheckId)).target, "emergency_contact");
    assert.equal((await accepted("transcript_updated", { ...contact, metadata: { ...contact.metadata, check_id: checkId } })).skipped, "stale_call");
    const replacement = `call_transcript_fixture_${randomUUID()}`;
    assert.equal((await db.from("checks").update({ last_call_id: replacement }).eq("id", contactCheckId)).error, null);
    assert.equal((await accepted("transcript_updated", contact)).skipped, "stale_call");
    assert.equal((await evidence(contactCheckId)).turns.length, 0);
    assertions.push("Contact target remains distinct; reassigned and cross-case callbacks cannot expose stale speech.");

    if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      assert.ok((await anon.from("heartbeat_call_transcripts").select("call_id")).error);
      assert.ok((await anon.rpc("apply_heartbeat_transcript", { p_check_id: checkId, p_call_id: callId, p_target: "client", p_status: "ongoing", p_turns: [], p_end_seconds: null, p_truncated: false })).error);
      assertions.push("Anonymous clients cannot read snapshots or execute their write RPC.");
    }
    passed = true;
  } finally {
    if (!(passed && keep)) {
      await db.from("events").delete().in("id", [eventId, contactEventId]);
      await db.from("clients").delete().eq("id", clientId);
    }
  }
  console.log(`Live transcript verification passed: ${assertions.length} scenario groups. No calls or texts placed.`);
  for (const assertion of assertions) console.log(`- ${assertion}`);
  if (keep) console.log(JSON.stringify({ fictional: true, eventId, checkId, callId }));
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Live transcript verification failed."); process.exitCode = 1; });
