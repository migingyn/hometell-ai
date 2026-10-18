import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendCaseEvidence, deriveCase, kindAllowedForRole } from './prescription-engine';
import { createReplayCase, REPLAY_BEATS, REPLAY_DURATION, SOURCE_BRIEFS } from './prescription-scenario';
import type { CaseEvidence, EvidenceKind, SourceRole } from './prescription';

function event(role: SourceRole, kind: EvidenceKind, revision: number, id = `${role}-${revision}-${kind}`): CaseEvidence {
  return { id, role, kind, revision, text: `Source reports ${kind}`, createdAt: '2026-10-17T20:00:00.000Z', origin: 'live-source' };
}
const milestone = (events: CaseEvidence[], id: string) => deriveCase(events).milestones.find((item) => item.id === id)!;

test('unknown case has no completed outcome, owner, or invented evidence', () => {
  const snapshot = deriveCase([]);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.owner, null);
  assert.equal(snapshot.confirmedCount, 0);
  assert.deepEqual(snapshot.activeEvidenceIds, []);
  assert.deepEqual(snapshot.latestByRole, {});
});

test('replay follows blocked, owned, received, approved, and pickup-confirmed milestones', () => {
  assert.equal(deriveCase(createReplayCase(4).events).status, 'blocked');
  assert.equal(deriveCase(createReplayCase(12).events).status, 'awaiting_confirmation');
  const conflict = deriveCase(createReplayCase(20).events);
  assert.equal(conflict.status, 'blocked');
  assert.equal(conflict.conflicts[0].resolved, false);
  assert.equal(conflict.owner, 'clinic');
  const owned = deriveCase(createReplayCase(29).events);
  assert.equal(owned.status, 'working');
  assert.match(owned.explanation, /Sarah.*3:00 PM/);
  assert.equal(owned.owner, 'clinic');
  assert.equal(deriveCase(createReplayCase(40).events).owner, 'insurer');
  const received = deriveCase(createReplayCase(50).events);
  assert.equal(received.status, 'awaiting_confirmation');
  assert.equal(received.conflicts[0].resolved, true);
  assert.equal(received.milestones.find((item) => item.id === 'insurer-decision')!.status, 'active');
  const approved = deriveCase(createReplayCase(61).events);
  assert.equal(approved.status, 'awaiting_confirmation');
  assert.equal(approved.owner, 'pharmacy');
  const ready = deriveCase(createReplayCase(80).events);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.owner, null);
  assert.equal(ready.unresolvedCount, 0);
  assert.equal(ready.confirmedCount, 6);
});

test('sent alone never establishes receipt, insurer completion, or pickup', () => {
  const events = [event('clinic', 'clinic_sent', 1)];
  const snapshot = deriveCase(events);
  assert.notEqual(snapshot.status, 'ready');
  assert.notEqual(milestone(events, 'clinic-resend').status, 'complete');
  assert.notEqual(milestone(events, 'insurer-receipt').status, 'complete');
  assert.notEqual(milestone(events, 'pharmacy-pickup').status, 'complete');
});

test('approval alone and an unsupported pharmacy-ready claim cannot establish readiness', () => {
  const unsupported = [event('insurer', 'insurer_approved', 1), event('pharmacy', 'pharmacy_ready', 1)];
  assert.notEqual(deriveCase(unsupported).status, 'ready');
  assert.notEqual(milestone(unsupported, 'insurer-receipt').status, 'complete');
  const noReceipt = createReplayCase(80).events.filter((item) => item.kind !== 'insurer_received');
  assert.notEqual(deriveCase(noReceipt).status, 'ready');
  assert.notEqual(milestone(noReceipt, 'insurer-decision').status, 'complete');
});

test('supporting IDs identify the actual dispatch, receipt, approval, and pickup evidence', () => {
  const events = createReplayCase(80).events;
  const id = (kind: EvidenceKind) => events.find((item) => item.kind === kind)!.id;
  const snapshot = deriveCase(events);
  assert.deepEqual(milestone(events, 'pharmacy-pickup').evidenceIds, [id('clinic_resent'), id('insurer_received'), id('insurer_approved'), id('pharmacy_ready')]);
  assert.deepEqual(snapshot.conflicts[0].evidenceIds, [id('clinic_sent'), id('insurer_missing'), id('clinic_resent'), id('insurer_received')]);
  assert.ok(snapshot.activeEvidenceIds.every((support) => events.some((item) => item.id === support)));
});

test('a newer pharmacy-pending report reopens a completed case', () => {
  const events = appendCaseEvidence(createReplayCase(80).events, event('pharmacy', 'pharmacy_pending', 3));
  const snapshot = deriveCase(events);
  assert.equal(snapshot.status, 'awaiting_confirmation');
  assert.equal(snapshot.owner, 'pharmacy');
  assert.equal(milestone(events, 'pharmacy-pickup').status, 'active');
  assert.equal(snapshot.conflicts[0].resolved, true);
  assert.ok(snapshot.unresolvedCount > 0);
});

test('a new missing-form report invalidates earlier receipt and readiness', () => {
  const events = appendCaseEvidence(createReplayCase(80).events, event('insurer', 'insurer_missing', 4));
  const snapshot = deriveCase(events);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.owner, 'clinic');
  assert.equal(snapshot.conflicts[0].resolved, false);
  assert.notEqual(milestone(events, 'insurer-receipt').status, 'complete');
  assert.notEqual(milestone(events, 'pharmacy-pickup').status, 'complete');
});

test('overdue promises preserve the unresolved owner and never imply dispatch', () => {
  const events = appendCaseEvidence(createReplayCase(29).events, {
    ...event('clinic', 'promise_overdue', 3), text: 'Sarah missed the 3 PM deadline. No resend has been confirmed.',
  });
  const snapshot = deriveCase(events);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.owner, 'clinic');
  assert.match(snapshot.explanation, /Sarah.*3 PM/);
  assert.notEqual(milestone(events, 'clinic-resend').status, 'complete');
  assert.ok(snapshot.unresolvedCount > 0);
});

test('wrong-role, unknown, malformed, stale, and duplicate events do not change the ledger', () => {
  const baseline = [event('clinic', 'clinic_accepted', 2)];
  const inputs = [
    event('clinic', 'pharmacy_ready', 3),
    event('clinic', 'unknown_kind' as EvidenceKind, 3),
    event('clinic', 'clinic_sent', 1),
    event('clinic', 'clinic_resent', 2),
    event('clinic', 'clinic_resent', 2.5),
    { ...event('clinic', 'clinic_resent', 3), id: baseline[0].id },
    { ...event('clinic', 'clinic_resent', 3), createdAt: 'not-a-date' },
  ];
  for (const input of inputs) {
    assert.deepEqual(appendCaseEvidence(baseline, input), baseline);
    assert.deepEqual(deriveCase([...baseline, input]), deriveCase(baseline));
  }
  assert.equal(kindAllowedForRole('pharmacy', 'insurer_approved'), false);
  assert.equal(kindAllowedForRole('insurer', 'insurer_received'), true);
  assert.deepEqual(baseline, [event('clinic', 'clinic_accepted', 2)]);
});

test('late stale revisions and out-of-order prerequisite claims cannot manufacture readiness', () => {
  let events = [event('clinic', 'clinic_resent', 3), event('insurer', 'insurer_approved', 3)];
  events = appendCaseEvidence(events, event('insurer', 'insurer_received', 2));
  events = appendCaseEvidence(events, event('pharmacy', 'pharmacy_ready', 1));
  assert.equal(events.length, 3);
  assert.notEqual(deriveCase(events).status, 'ready');
  const reversed = [event('pharmacy', 'pharmacy_ready', 1), ...createReplayCase(61).events];
  assert.notEqual(deriveCase(reversed).status, 'ready');
});

test('an unreachable source interrupts progress and leaves its state unknown', () => {
  const events = appendCaseEvidence(createReplayCase(80).events, event('insurer', 'contact_unreachable', 4));
  const snapshot = deriveCase(events);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.owner, 'insurer');
  assert.notEqual(milestone(events, 'insurer-decision').status, 'complete');
});

test('replay is deterministic, 70–90 seconds, and all source provenance is explicitly scripted', () => {
  assert.ok(REPLAY_DURATION >= 70 && REPLAY_DURATION <= 90);
  assert.deepEqual(createReplayCase(REPLAY_DURATION), createReplayCase(10_000));
  assert.deepEqual(createReplayCase(-1).events, []);
  assert.deepEqual(createReplayCase(NaN).events, []);
  assert.equal(createReplayCase(80).mode, 'replay');
  const revisions: Partial<Record<SourceRole, number>> = {};
  for (const beat of REPLAY_BEATS) {
    assert.match(beat.event.id, /^replay-/);
    assert.equal(beat.event.origin, 'scripted');
    assert.match(beat.event.sourceLabel!, /Scripted replay.*fictional/);
    assert.equal(beat.event.revision, (revisions[beat.event.role] ?? 0) + 1);
    revisions[beat.event.role] = beat.event.revision;
  }
  for (const brief of Object.values(SOURCE_BRIEFS)) {
    assert.match(brief.label, /fictional/);
    assert.ok(brief.options.every((option) => kindAllowedForRole(brief.role, option.kind)));
  }
});
