// Isolated local API/database fixtures only. No telephony or external requests.
import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabase";
import { POSTOP_FIELDS, type PostOpAssessment } from "../lib/postop/types";
import type { AnswerReview, AnswerReviews } from "../lib/postop/answer-review";

const base = new URL(process.env.ANSWER_REVIEW_APP_URL ?? "http://127.0.0.1:3018");
const database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
const ids = { client: randomUUID(), event: randomUUID(), check: randomUUID(), call: `mock_answer_review_${randomUUID()}` };
const original: PostOpAssessment = {
  version: 1, call_id: ids.call, recorded_at: "2000-01-01T00:00:00Z", patient_confirmed: true,
  identity_quote: "Yes, this is the fictional test patient.",
  answers: Object.fromEntries(POSTOP_FIELDS.map(field => [field, field === "pain"
    ? { status: "reported", value: 7, quote: "My pain is seven." }
    : { status: "unknown", value: null, quote: null }])) as PostOpAssessment["answers"],
  changes: [], comparison: { previous_call_id: null, status: "no_previous_check", unavailable_fields: [...POSTOP_FIELDS] },
  suggested_next_step: { action: "nurse_review", label: "Review answers", reason: "Fictional verification", status: "approved", approved_at: "2000-01-01T00:01:00Z", reviewer: "Prior nurse" },
};
const route = `/api/checks/${ids.check}/answer-review`;
async function request(body?: unknown, call = ids.call) {
  const response = await fetch(new URL(body === undefined ? `${route}?call_id=${encodeURIComponent(call)}` : route, base), {
    method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function main() {
  for (const url of [base, database]) assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok([base.origin, database.origin].includes(url.origin), "Verification forbids external network requests");
    return originalFetch(input, init);
  };
  const db = supabaseAdmin();
  const preflight = await db.rpc("read_heartbeat_answer_reviews", { p_check_id: ids.check, p_call_id: ids.call });
  assert.equal(preflight.error, null, "Root must apply migration012 before this verification");
  assert.equal(preflight.data.error_kind, "unknown_check");
  try {
    const client = await db.from("clients").insert({ id: ids.client, name: "Fictional answer-review verification", phone: "+12025550199", risk_tier: "green",
      emergency_contact_name: "Fictional verification", emergency_contact_phone: "+12025550198" });
    assert.equal(client.error, null);
    const event = await db.from("events").insert({ id: ids.event, type: "daily", started_at: "2000-01-01T00:00:00Z" });
    assert.equal(event.error, null);
    const check = await db.from("checks").insert({ id: ids.check, event_id: ids.event, client_id: ids.client,
      status: "needs_human", urgency: "follow_up", last_call_id: ids.call, postop_assessment: original });
    assert.equal(check.error, null);
    const log = await db.from("call_logs").insert({ check_id: ids.check, retell_call_id: ids.call, target: "client", outcome: "needs_human", transcript: "User: My pain is seven.", raw: { simulated: true } });
    assert.equal(log.error, null);
    const initial = await request();
    assert.equal(initial.status, 200);
    const sources = (initial.body.data as AnswerReviews).sources;
    assert.equal(Object.keys(sources).length, 8);
    assert.deepEqual(initial.body.data.reviews, []);
    const confirm = { call_id: ids.call, field: "pain", action: "confirm", reviewer: "Test reviewer", expected_revision: 0, expected_source: sources.pain.fingerprint };
    const concurrent = await Promise.all([request(confirm), request(confirm)]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    assert.equal(concurrent.find(result => result.status === 200)!.body.data.review.revision, 1);
    const corrected = await request({ ...confirm, action: "correct", corrected_value: 4, expected_revision: 1 });
    assert.equal(corrected.status, 200);
    const review = corrected.body.data.review as AnswerReview;
    assert.equal(review.revision, 2); assert.equal(review.original_answer.value, 7); assert.equal(review.corrected_value, 4);
    const unknown = await request({ ...confirm, action: "correct", corrected_value: null, expected_revision: 2 });
    assert.equal(unknown.status, 200); assert.equal(unknown.body.data.review.corrected_value, null);
    assert.equal((await request({ ...confirm, field: "fever", expected_source: sources.fever.fingerprint })).status, 400);
    assert.equal((await request({ ...confirm, action: "correct", corrected_value: 11, expected_revision: 3 })).status, 400);
    const unchanged = await db.from("checks").select("postop_assessment,status").eq("id", ids.check).single();
    assert.deepEqual(unchanged.data?.postop_assessment, original);
    assert.equal(unchanged.data?.status, "needs_human");
    const history = await db.from("heartbeat_answer_reviews").select("revision,original_answer,action,corrected_value").eq("check_id", ids.check).order("revision");
    assert.equal(history.error, null); assert.deepEqual(history.data?.map(row => row.revision), [1, 2, 3]);
    assert.ok(history.data?.every(row => row.original_answer.value === 7 && row.original_answer.quote === "My pain is seven."));
    const refreshed = structuredClone(original);
    refreshed.answers.pain = { status: "reported", value: 8, quote: "My pain is eight now." };
    assert.equal((await db.from("checks").update({ postop_assessment: refreshed }).eq("id", ids.check)).error, null);
    assert.equal((await request({ ...confirm, expected_revision: 3 })).status, 409);
    const afterRefresh = await request();
    assert.equal(afterRefresh.body.data.reviews[0].source_current, false);
    assert.notEqual(afterRefresh.body.data.sources.pain.fingerprint, sources.pain.fingerprint);
    assert.equal((await request({ ...confirm, expected_revision: 3, expected_source: afterRefresh.body.data.sources.pain.fingerprint })).status, 200);
    assert.equal((await request(undefined, "unknown_call")).status, 404);
    assert.equal((await db.from("checks").update({ last_call_id: `mock_new_${randomUUID()}` }).eq("id", ids.check)).error, null);
    assert.equal((await request()).status, 409);
    assert.equal((await request({ ...confirm, expected_revision: 4 })).status, 409);
    const anon = createClient(database.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    assert.ok((await anon.from("heartbeat_answer_reviews").select("id").eq("check_id", ids.check)).error);
    assert.ok((await anon.rpc("read_heartbeat_answer_reviews", { p_check_id: ids.check, p_call_id: ids.call })).error);
    console.log("Answer review verification passed: concurrent review conflict; immutable extraction, quote and nurse approval; append-only history; explicit unknown; source refresh and stale-call protection; anonymous access denied. No calls or external requests.");
  } finally {
    // Delete only this run's fixtures; child audit records are removed by their fixture FK.
    const removedEvent = await db.from("events").delete().eq("id", ids.event);
    const removedClient = await db.from("clients").delete().eq("id", ids.client);
    globalThis.fetch = originalFetch;
    assert.equal(removedEvent.error, null); assert.equal(removedClient.error, null);
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Answer review verification failed"); process.exitCode = 1; });
