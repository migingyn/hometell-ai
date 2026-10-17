import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { CreatePhoneCallInput, PhoneCallRecord } from "../retell";
import { approvedContacts, callContact, getCallResult, type ActionStore, type VoiceAction } from "./actions";

const envNames = ["MOCK_RETELL", "VOICE_OUTBOUND_CONTACTS", "RETELL_DELEGATE_AGENT_ID", "RETELL_AGENT_ID"] as const;
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const context = { callId: "parent-call-1", delegationDepth: 0 };
const request = { contactId: "county-desk", purpose: "Confirm the public shelter opening hours", callerConfirmed: true };

beforeEach(() => {
  process.env.MOCK_RETELL = "false";
  process.env.RETELL_AGENT_ID = "parent-agent";
  process.env.RETELL_DELEGATE_AGENT_ID = "delegate-agent";
  process.env.VOICE_OUTBOUND_CONTACTS = JSON.stringify([
    { id: "county-desk", name: "County information desk", phone: "+12025550123" },
  ]);
});

afterEach(() => {
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

function memoryStore(seed: VoiceAction[] = []) {
  const rows = new Map(seed.map((action) => [action.id, structuredClone(action)]));
  const keys = new Map<string, string>();
  const claims: Parameters<ActionStore["claim"]>[0][] = [];
  const updates: { id: string; patch: Partial<VoiceAction> }[] = [];
  const store: ActionStore = {
    async claim(input) {
      claims.push(structuredClone(input));
      const key = `${input.parentCallId}:${input.requestKey}`;
      const existing = keys.get(key);
      if (existing) return { created: false, action: structuredClone(rows.get(existing)!) };
      const action: VoiceAction = {
        id: `action-${rows.size + 1}`, parent_call_id: input.parentCallId,
        contact_id: input.contactId, purpose: input.purpose, external_call_id: null,
        status: "dispatching", result: null,
      };
      rows.set(action.id, action);
      keys.set(key, action.id);
      return { created: true, action: structuredClone(action) };
    },
    async find(actionId, parentCallId) {
      const action = rows.get(actionId);
      return action?.parent_call_id === parentCallId ? structuredClone(action) : null;
    },
    async update(actionId, patch) {
      const action = rows.get(actionId);
      assert.ok(action, "Only a claimed action may be updated");
      updates.push({ id: actionId, patch: structuredClone(patch) });
      rows.set(actionId, { ...action, ...structuredClone(patch) });
    },
  };
  return { store, rows, claims, updates };
}

function queuedAction(patch: Partial<VoiceAction> = {}): VoiceAction {
  return {
    id: "action-1", parent_call_id: context.callId, contact_id: request.contactId,
    purpose: request.purpose, external_call_id: "remote-call-1", status: "queued", result: null,
    ...patch,
  };
}

function remoteCall(patch: Partial<PhoneCallRecord> = {}): PhoneCallRecord {
  return {
    call_id: "remote-call-1", call_status: "ongoing",
    metadata: { parent_call_id: context.callId, voice_action_id: "action-1", delegation_depth: 1 },
    ...patch,
  };
}

test("unapproved contact, missing confirmation, delegation, and mock mode never claim or dial", async () => {
  const db = memoryStore();
  let dials = 0;
  const dial = async () => { dials++; return { callId: "must-not-dial" }; };
  await assert.rejects(callContact({ ...request, contactId: "unknown" }, context, { store: db.store, dial }), /approved directory/);
  await assert.rejects(callContact({ ...request, callerConfirmed: false }, context, { store: db.store, dial }), /confirm/);
  await assert.rejects(callContact(request, { ...context, delegationDepth: 1 }, { store: db.store, dial }), /cannot place further calls/);
  process.env.MOCK_RETELL = "true";
  await assert.rejects(callContact(request, context, { store: db.store, dial }), /MOCK_RETELL=false/);
  assert.equal(dials, 0);
  assert.equal(db.claims.length, 0);
});

test("invalid purpose and malformed approved directory fail before claiming or dialing", async () => {
  const db = memoryStore();
  let dials = 0;
  const dial = async () => { dials++; return { callId: "must-not-dial" }; };
  for (const purpose of [" ", "x".repeat(1001)]) {
    await assert.rejects(callContact({ ...request, purpose }, context, { store: db.store, dial }), /purpose/);
  }
  process.env.VOICE_OUTBOUND_CONTACTS = JSON.stringify([{ id: "county-desk", name: "Desk", phone: "5551234" }]);
  await assert.rejects(callContact(request, context, { store: db.store, dial }));
  process.env.VOICE_OUTBOUND_CONTACTS = "invalid-json";
  await assert.rejects(callContact(request, context, { store: db.store, dial }));
  assert.equal(db.claims.length, 0);
  assert.equal(dials, 0);
});

test("duplicate directory IDs are rejected without choosing an arbitrary phone number", () => {
  process.env.VOICE_OUTBOUND_CONTACTS = JSON.stringify([
    { id: "same", name: "One", phone: "+12025550123" },
    { id: "same", name: "Two", phone: "+12025550124" },
  ]);
  assert.throws(() => approvedContacts(), /duplicate IDs/);
});

test("approved action calls the real transport seam once and saves the provider ID", async () => {
  const db = memoryStore();
  const dialInputs: CreatePhoneCallInput[] = [];
  const output = await callContact(request, context, {
    store: db.store,
    dial: async (input) => { dialInputs.push(input); return { callId: "remote-call-1" }; },
  });
  assert.equal(dialInputs.length, 1);
  assert.equal(dialInputs[0].toNumber, "+12025550123");
  assert.equal(dialInputs[0].agentId, "delegate-agent");
  assert.equal(dialInputs[0].idempotencyKey, output.actionId);
  assert.deepEqual(dialInputs[0].metadata, {
    voice_action_id: output.actionId, parent_call_id: context.callId, delegation_depth: 1,
  });
  assert.deepEqual(dialInputs[0].dynamicVariables, { call_role: "delegate", voice_task: request.purpose });
  assert.equal(output.status, "queued");
  assert.match(output.message, /has not provided an answer yet/);
  assert.equal(db.rows.get(output.actionId)?.external_call_id, "remote-call-1");
  assert.equal(db.rows.get(output.actionId)?.status, "queued");
});

test("normalized duplicate requests share one durable claim and never redial", async () => {
  const db = memoryStore();
  let dials = 0;
  const dial = async () => { dials++; return { callId: "remote-call-1" }; };
  const first = await callContact(request, context, { store: db.store, dial });
  const second = await callContact({
    ...request, purpose: "   CONFIRM   the public shelter opening hours   ",
  }, context, { store: db.store, dial });
  assert.equal(first.actionId, second.actionId);
  assert.equal(second.status, "queued");
  assert.equal(db.claims[0].requestKey, db.claims[1].requestKey);
  assert.equal(db.rows.size, 1);
  assert.equal(dials, 1);
});

test("concurrent duplicate requests cannot each reach the dial transport", async () => {
  const db = memoryStore();
  let dials = 0;
  const dial = async () => { dials++; return { callId: "remote-call-1" }; };
  const outputs = await Promise.all([
    callContact(request, context, { store: db.store, dial }),
    callContact(request, context, { store: db.store, dial }),
  ]);
  assert.equal(outputs[0].actionId, outputs[1].actionId);
  assert.equal(dials, 1);
});

test("a reservation or call limit failure never reaches the telephone provider", async () => {
  const db = memoryStore();
  db.store.claim = async () => { throw new Error("Outbound call limit reached"); };
  let dials = 0;
  await assert.rejects(callContact(request, context, {
    store: db.store, dial: async () => { dials++; return { callId: "must-not-dial" }; },
  }), /limit reached/);
  assert.equal(dials, 0);
});

test("a possibly accepted provider request stays unknown and is never automatically retried", async () => {
  const db = memoryStore();
  let dials = 0;
  const dial = async (): Promise<{ callId: string }> => { dials++; throw new Error("Connection lost after send"); };
  const first = await callContact(request, context, { store: db.store, dial });
  const second = await callContact(request, context, { store: db.store, dial });
  assert.equal(first.status, "unknown");
  assert.equal(second.status, "unknown");
  assert.match(first.message, /Do not place a duplicate call/);
  assert.equal(db.rows.get(first.actionId)?.status, "unknown");
  assert.equal(dials, 1);
});

test("a storage failure after provider acceptance preserves the claim and prevents redial", async () => {
  const db = memoryStore();
  db.store.update = async () => { throw new Error("database unavailable"); };
  let dials = 0;
  const dial = async () => { dials++; return { callId: "remote-call-1" }; };
  const first = await callContact(request, context, { store: db.store, dial });
  const second = await callContact(request, context, { store: db.store, dial });
  assert.equal(first.status, "unknown");
  assert.equal(first.actionId, second.actionId);
  assert.notEqual(second.status, "completed");
  assert.match(first.message, /Do not place a duplicate call/);
  assert.equal(dials, 1);
});

test("a different parent cannot read or poll an outbound action", async () => {
  const db = memoryStore([queuedAction()]);
  let reads = 0;
  await assert.rejects(getCallResult("action-1", { ...context, callId: "other-parent" }, {
    store: db.store, getCall: async () => { reads++; return remoteCall(); },
  }), /belongs to this call/);
  assert.equal(reads, 0);
  assert.equal(db.updates.length, 0);
});

test("mismatched or absent provider ownership metadata cannot update the action", async () => {
  const db = memoryStore([queuedAction()]);
  for (const metadata of [
    undefined,
    { parent_call_id: "other-parent", voice_action_id: "action-1" },
    { parent_call_id: context.callId, voice_action_id: "other-action" },
  ]) {
    await assert.rejects(getCallResult("action-1", context, {
      store: db.store, getCall: async () => remoteCall({ metadata, call_status: "ended" }),
    }), /ownership/);
  }
  assert.equal(db.updates.length, 0);
  assert.equal(db.rows.get("action-1")?.status, "queued");
});

test("an ongoing call remains queued, withholds partial transcript, and cannot report task completion", async () => {
  const db = memoryStore([queuedAction()]);
  const output = await getCallResult("action-1", context, {
    store: db.store,
    getCall: async () => remoteCall({ transcript: "Unfinished statement, not an answer" }),
  });
  assert.equal(output.status, "queued");
  assert.match(output.message, /has not been confirmed complete/);
  const saved = db.rows.get("action-1");
  assert.equal(saved?.status, "queued");
  assert.deepEqual(saved?.result, {
    callStatus: "ongoing", summary: null, transcript: null,
    limitation: "Recipient statements are reported information. A completed call does not establish that a requested real-world action occurred.",
  });
});

test("terminal recipient information is bounded, saved, and reused without another provider read", async () => {
  const db = memoryStore([queuedAction()]);
  let reads = 0;
  const getCall = async (id: string) => {
    reads++;
    assert.equal(id, "remote-call-1");
    return remoteCall({
      call_status: "ended", transcript: "t".repeat(4000),
      call_analysis: { call_summary: "s".repeat(2200), call_successful: true },
    });
  };
  const first = await getCallResult("action-1", context, { store: db.store, getCall });
  const second = await getCallResult("action-1", context, { store: db.store, getCall });
  assert.equal(first.status, "completed");
  assert.deepEqual(second, first);
  const saved = db.rows.get("action-1")!;
  assert.equal(saved.status, "completed");
  const evidence = saved.result as { summary: string; transcript: string; limitation: string };
  assert.equal(evidence.summary.length, 1800);
  assert.equal(evidence.transcript.length, 3000);
  assert.match(evidence.limitation, /does not establish/);
  assert.match(first.message, /use only the returned recipient information/);
  assert.equal(reads, 1);
  assert.equal(db.updates.length, 1);
});

test("not-connected calls are failed rather than represented as a recipient answer", async () => {
  const db = memoryStore([queuedAction()]);
  const output = await getCallResult("action-1", context, {
    store: db.store, getCall: async () => remoteCall({ call_status: "not_connected" }),
  });
  assert.equal(output.status, "failed");
  assert.match(output.message, /has not been confirmed complete/);
  assert.equal(db.rows.get("action-1")?.status, "failed");
});

test("an unknown request without a provider call ID never invents a status or polls", async () => {
  const db = memoryStore([queuedAction({ external_call_id: null, status: "unknown" })]);
  let reads = 0;
  const output = await getCallResult("action-1", context, {
    store: db.store, getCall: async () => { reads++; return remoteCall({ call_status: "ended" }); },
  });
  assert.equal(output.status, "unknown");
  assert.equal(reads, 0);
  assert.equal(db.updates.length, 0);
});

test("a provider read failure preserves the saved action without silently retrying", async () => {
  const db = memoryStore([queuedAction()]);
  let reads = 0;
  await assert.rejects(getCallResult("action-1", context, {
    store: db.store, getCall: async () => { reads++; throw new Error("provider temporarily unavailable"); },
  }), /temporarily unavailable/);
  assert.equal(reads, 1);
  assert.equal(db.rows.get("action-1")?.status, "queued");
  assert.equal(db.updates.length, 0);
});
