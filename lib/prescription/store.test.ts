import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DemoError, PrescriptionDemoStore } from './store';
import { deriveCase } from '../../shared/prescription-engine';
import type { SourceRole } from '../../shared/prescription';

const directories: string[] = [];
after(async () => { await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prescription-store-'));
  directories.push(directory);
  const store = new PrescriptionDemoStore(directory);
  const created = await store.create();
  const sourceToken = (role: SourceRole) => new URL(created.sourceLinks[role], 'http://localhost').searchParams.get('token')!;
  return { directory, store, created, sourceToken };
}

test('live rooms start empty and private source links cannot impersonate other roles', async () => {
  const { store, created, sourceToken } = await fixture();
  assert.deepEqual(created.session.events, []);
  assert.equal((await store.get(created.session.id, created.operatorToken)).mode, 'live');
  await assert.rejects(store.get(created.session.id, 'invalid'), (e: unknown) => e instanceof DemoError && e.status === 403);
  await assert.rejects(store.get(created.session.id, 'é'.repeat(48)), (e: unknown) => e instanceof DemoError && e.status === 403);
  await assert.rejects(store.evidence(created.session.id, sourceToken('clinic'), 'pharmacy', 'pharmacy_ready', 'The fictional case is ready.'), /cannot speak/i);
  await assert.rejects(store.evidence(created.session.id, created.operatorToken, 'pharmacy', 'pharmacy_ready', 'The fictional case is ready.'), /cannot speak/i);
  await assert.rejects(store.evidence(created.session.id, sourceToken('clinic'), 'clinic', 'pharmacy_ready', 'The fictional case is ready.'), /cannot confirm/i);
});

test('concurrent real participant submissions preserve both events and server revisions', async () => {
  const { store, created, sourceToken } = await fixture();
  await Promise.all([
    store.evidence(created.session.id, sourceToken('clinic'), 'clinic', 'clinic_sent', 'Our fictional clinic sent the form.'),
    store.evidence(created.session.id, sourceToken('insurer'), 'insurer', 'insurer_missing', 'Our fictional insurer needs the signed page.'),
  ]);
  const result = await store.get(created.session.id, created.operatorToken);
  assert.equal(result.events.length, 2);
  assert.deepEqual(new Set(result.events.map((event) => event.role)), new Set(['clinic', 'insurer']));
  assert.ok(result.events.every((event) => event.origin === 'live-source' && event.revision === 1));
  assert.notEqual(deriveCase(result.events).status, 'ready');
});

test('local sessions survive a new store instance and are written with private file permissions', async () => {
  const { store, created, directory, sourceToken } = await fixture();
  await store.evidence(created.session.id, sourceToken('pharmacy'), 'pharmacy', 'pharmacy_blocked', 'The fictional claim has not cleared yet.');
  const reopened = new PrescriptionDemoStore(directory);
  assert.equal((await reopened.get(created.session.id, created.operatorToken)).events.length, 1);
  assert.equal((await stat(path.join(directory, `${created.session.id}.json`))).mode & 0o777, 0o600);
  await assert.rejects(store.get('../../outside', created.operatorToken), /Unknown/i);
});

test('only the presenter can reserve a phone call and repeated claims never start another attempt', async () => {
  const { store, created, sourceToken } = await fixture();
  await assert.rejects(store.claimPhone(created.session.id, sourceToken('clinic'), 'clinic'), /presenter/i);
  const claims = await Promise.all([
    store.claimPhone(created.session.id, created.operatorToken, 'clinic'),
    store.claimPhone(created.session.id, created.operatorToken, 'clinic'),
  ]);
  assert.equal(claims.filter((claim) => claim.created).length, 1);
  await store.finishPhone(created.session.id, 'clinic', 'call_real_provider_receipt');
  const duplicate = await store.claimPhone(created.session.id, created.operatorToken, 'clinic');
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.call?.callId, 'call_real_provider_receipt');
});

test('phone evidence binds to its registered source call and suppresses duplicate callbacks', async () => {
  const { store, created } = await fixture();
  await store.claimPhone(created.session.id, created.operatorToken, 'clinic');
  await store.finishPhone(created.session.id, 'clinic', 'call_registered');
  await assert.rejects(store.phoneEvidence(created.session.id, 'clinic', 'call_other', 'clinic_sent', 'Our fictional clinic sent the form.'), /not registered/i);
  await store.phoneEvidence(created.session.id, 'clinic', 'call_registered', 'clinic_sent', 'Our fictional clinic sent the form.');
  await store.phoneEvidence(created.session.id, 'clinic', 'call_registered', 'clinic_sent', 'Our fictional clinic sent the form.');
  const session = await store.get(created.session.id, created.operatorToken);
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].origin, 'retell');
  assert.equal(session.events[0].callId, 'call_registered');
});

test('uncertain phone requests remain claimed and expired rooms cannot be reused', async () => {
  const { store, created, directory } = await fixture();
  await store.claimPhone(created.session.id, created.operatorToken, 'pharmacy');
  await store.finishPhone(created.session.id, 'pharmacy');
  const claim = await store.claimPhone(created.session.id, created.operatorToken, 'pharmacy');
  assert.equal(claim.created, false);
  assert.equal(claim.call?.status, 'unknown');
  const filename = path.join(directory, `${created.session.id}.json`);
  const data = JSON.parse(await readFile(filename, 'utf8'));
  data.session.createdAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  await writeFile(filename, JSON.stringify(data));
  await assert.rejects(store.get(created.session.id, created.operatorToken), (e: unknown) => e instanceof DemoError && e.status === 410);
});
