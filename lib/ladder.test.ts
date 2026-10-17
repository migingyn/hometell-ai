import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "./config";
import { applyCallResult, runLadderStep } from "./ladder";
import type { Check, ClassifierResult, Client, HeartbeatEvent } from "./types";
import type { SmsResult } from "./sms";

const client: Client = { id: "client", name: "Fictional Client", phone: "+15555550111", risk_tier: "red", lives_alone: true,
  uses_powered_equipment: false, emergency_contact_name: "Elaine", emergency_contact_phone: "+15555550112", usual_pickup_time: null };
const event: HeartbeatEvent = { id: "event", type: "crisis", started_at: "2026-10-17T20:00:00Z", alert_text: "This is the exact official alert text." };
const check = (patch: Partial<Check> = {}): Check => ({ id: "check", event_id: "event", client_id: "client", status: "no_answer", ladder_step: 0,
  last_call_id: "call_current", next_action_at: "2026-10-17T20:05:00Z", summary: null, flag_reason: null, handled_at: null,
  updated_at: "2026-10-17T20:00:00Z", urgency: null, sms_status: null, ...patch });
const missed: ClassifierResult = { status: "no_answer", summary: "No direct response", flag_reason: null, urgency: null };
const okay: ClassifierResult = { status: "ok", summary: "Confirmed okay by Elaine: she is with me.", flag_reason: null, urgency: null };
const sms: SmsResult = { id: null, status: "not_configured", note: "text not sent (SMS not configured)" };
const next = "2026-10-17T20:10:00Z";

test("client retry and emergency-contact steps place the right real-call request and save its ID", async () => {
  for (const [ladderStep, target] of [[0, "client"], [2, "emergency_contact"]] as const) {
    const patch = await runLadderStep(check({ ladder_step: ladderStep }), client, event, {
      placeCall: async (input) => {
        assert.equal(input.target, target);
        assert.equal(input.client, client);
        assert.equal(input.checkId, "check");
        assert.deepEqual(input.event, event);
        return { callId: `call_${target}` };
      },
    });
    assert.equal(patch.ladder_step, ladderStep + 1);
    assert.equal(patch.status, "calling");
    assert.equal(patch.last_call_id, `call_${target}`);
    assert.equal(patch.next_action_at, null);
  }
});

test("daily client SMS contains callback information and advances even when SMS is not configured", async () => {
  const old = config.coordinatorPhone;
  config.coordinatorPhone = "+15555550113";
  try {
    const patch = await runLadderStep(check({ ladder_step: 1 }), client, { ...event, type: "daily", alert_text: null }, {
      sendSms: async (to, body) => {
        assert.equal(to, client.phone);
        assert.match(body, /missed you at your check-in/);
        assert.match(body, /15555550113/);
        assert.doesNotMatch(body, /official alert/);
        return sms;
      }, nextActionAt: () => next,
    });
    assert.equal(patch.status, "no_answer");
    assert.equal(patch.ladder_step, 2);
    assert.equal(patch.next_action_at, next);
    assert.equal(patch.sms_status, "text not sent (SMS not configured)");
  } finally { config.coordinatorPhone = old; }
});

test("crisis client SMS preserves the official alert verbatim before callback copy", async () => {
  const patch = await runLadderStep(check({ ladder_step: 1 }), client, event, {
    sendSms: async (_to, body) => {
      assert.ok(body.startsWith(`${event.alert_text}\n\n`));
      assert.match(body, /couldn't reach you by phone/);
      return sms;
    }, nextActionAt: () => next,
  });
  assert.equal(patch.ladder_step, 2);
});

test("unreachable terminal step always escalates and persists even if the coordinator text fails", async () => {
  for (const mode of ["daily", "crisis"]) {
    const patch = await runLadderStep(check({ ladder_step: 3 }), client, { ...event, type: mode }, {
      alertCoordinator: async (recipient, reason) => {
        assert.equal(recipient, client);
        assert.match(reason, /unreachable/);
        throw new Error("provider-private-key");
      },
    });
    assert.equal(patch.status, "needs_human");
    assert.equal(patch.urgency, "urgent");
    assert.equal(patch.flag_reason, "unreachable");
    assert.equal(patch.ladder_step, 4);
    assert.equal(patch.next_action_at, null);
    assert.match(patch.sms_status!, /text status unknown/);
    assert.doesNotMatch(JSON.stringify(patch), /provider-private-key/);
  }
});

test("failed phone or client SMS requests keep the ladder moving without fabricated success", async () => {
  const failedCall = await runLadderStep(check(), client, event, {
    placeCall: async () => { throw new Error("private phone details"); }, nextActionAt: () => next,
  });
  assert.equal(failedCall.status, "no_answer");
  assert.equal(failedCall.ladder_step, 1);
  assert.equal(failedCall.next_action_at, next);
  assert.equal(failedCall.last_call_id, undefined);
  const failedText = await runLadderStep(check({ ladder_step: 1 }), client, event, {
    sendSms: async () => { throw new Error("private phone details"); }, nextActionAt: () => next,
  });
  assert.equal(failedText.ladder_step, 2);
  assert.equal(failedText.next_action_at, next);
  assert.match(failedText.sms_status!, /unknown/);
});

test("settled, calling, handled, and terminal checks never perform another ladder action", async () => {
  let calls = 0;
  const deps = { placeCall: async () => { calls++; return { callId: "unexpected" }; } };
  for (const status of ["ok", "calling", "needs_human", "handled", "queued"] as const) {
    assert.deepEqual(await runLadderStep(check({ status }), client, event, deps), {});
  }
  assert.deepEqual(await runLadderStep(check({ ladder_step: 4 }), client, event, deps), {});
  assert.deepEqual(await runLadderStep(check({ handled_at: "2026-10-17T20:00:00Z" }), client, event, deps), {});
  assert.equal(calls, 0);
});

test("late, stale, and handled webhook results cannot overwrite current work", () => {
  assert.deepEqual(applyCallResult(check(), okay, "emergency_contact", "call_old"), {});
  assert.deepEqual(applyCallResult(check({ status: "handled" }), okay, "client", "call_current"), {});
  assert.deepEqual(applyCallResult(check({ handled_at: "2026-10-17T20:00:00Z" }), missed, "client", "call_current"), {});
});

test("contact-confirmed okay ends the ladder; an unconfirmed contact keeps it active", () => {
  const confirmed = applyCallResult(check({ ladder_step: 3 }), okay, "emergency_contact", "call_current");
  assert.equal(confirmed.status, "ok");
  assert.equal(confirmed.next_action_at, null);
  assert.match(confirmed.summary!, /^Confirmed okay by Elaine:/);
  const unconfirmed = applyCallResult(check({ ladder_step: 3 }), missed, "emergency_contact", "call_current");
  assert.equal(unconfirmed.status, "no_answer");
  assert.ok(unconfirmed.next_action_at);
});

test("a danger-word alert cannot be downgraded to okay or an ordinary daily follow-up", () => {
  const danger = check({ status: "needs_human", urgency: "urgent", flag_reason: 'said "dizzy"' });
  assert.deepEqual(applyCallResult(danger, okay, "client", "call_current"), {});
  assert.deepEqual(applyCallResult(danger, { status: "needs_human", summary: "Groceries", flag_reason: "groceries", urgency: "follow_up" }, "client", "call_current"), {});
});
