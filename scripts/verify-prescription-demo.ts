import assert from 'node:assert/strict';
import { SOURCE_BRIEFS } from '../shared/prescription-scenario';
import { deriveCase } from '../shared/prescription-engine';
import type { EvidenceKind, PrescriptionCase, SourceRole } from '../shared/prescription';

const origin = process.env.PRESCRIPTION_DEMO_URL || 'http://127.0.0.1:5175';

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(10000) });
}
async function main() {
  const ready = await request('/api/prescription/readiness');
  assert.equal(ready.status, 200, 'Rehearsal backend must be reachable through the frontend');
  assert.equal((await ready.json()).liveRooms, true);
  const created = await request('/api/prescription/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ syntheticDataOnly: true }),
  });
  assert.equal(created.status, 201);
  const { session, operatorToken, sourceLinks } = await created.json() as {
    session: PrescriptionCase; operatorToken: string; sourceLinks: Record<SourceRole, string>;
  };
  const sourceToken = (role: SourceRole) => new URL(sourceLinks[role], origin).searchParams.get('token')!;
  const path = `/api/prescription/sessions/${session.id}`;
  const submit = async (role: SourceRole, kind: EvidenceKind) => {
    const text = SOURCE_BRIEFS[role].options.find((option) => option.kind === kind)!.text;
    const response = await request(`${path}/evidence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sourceToken(role)}` },
      body: JSON.stringify({ role, kind, text }),
    });
    assert.equal(response.status, 200);
    return await response.json() as PrescriptionCase;
  };
  const denied = await request(`${path}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ role: 'pharmacy', kind: 'pharmacy_ready', text: 'A presenter cannot impersonate the pharmacy.' }),
  });
  assert.equal(denied.status, 403);
  let current = await submit('pharmacy', 'pharmacy_blocked');
  current = await submit('clinic', 'clinic_sent');
  current = await submit('insurer', 'insurer_missing');
  assert.ok(deriveCase(current.events).conflicts.some((conflict) => !conflict.resolved));
  current = await submit('clinic', 'clinic_accepted');
  current = await submit('clinic', 'clinic_resent');
  assert.notEqual(deriveCase(current.events).status, 'ready');
  current = await submit('insurer', 'insurer_received');
  current = await submit('insurer', 'insurer_approved');
  assert.notEqual(deriveCase(current.events).status, 'ready');
  current = await submit('pharmacy', 'pharmacy_ready');
  assert.equal(deriveCase(current.events).status, 'ready');
  current = await submit('pharmacy', 'pharmacy_pending');
  assert.notEqual(deriveCase(current.events).status, 'ready');
  const persisted = await request(path, { headers: { Authorization: `Bearer ${operatorToken}` } });
  assert.deepEqual((await persisted.json()).events, current.events);
  const callDenied = await request(`${path}/call`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ role: 'pharmacy', consent: true }),
  });
  assert.equal(callDenied.status, 403, 'No telephone request may proceed without the private presenter call token');
  console.log('PASS: actual frontend proxy → backend → private source rooms → persisted receipts → conflict → ready → reopened.');
  console.log('PASS: presenter cannot impersonate a source; uncredentialed telephone request denied. No phone calls were placed.');
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : 'Live-room verification failed'); process.exitCode = 1; });
