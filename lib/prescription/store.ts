import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { appendCaseEvidence, kindAllowedForRole } from '../../shared/prescription-engine';
import type { CaseEvidence, EvidenceKind, PrescriptionCase, SourceRole } from '../../shared/prescription';

export class DemoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type PhoneAttempt = { status: 'dispatching' | 'queued' | 'unknown'; callId?: string };
type StoredCase = {
  session: PrescriptionCase;
  operatorToken: string;
  sourceTokens: Record<SourceRole, string>;
  phoneCalls: Partial<Record<SourceRole, PhoneAttempt>>;
};

function matches(actual: string, expected: string) {
  const incoming = Buffer.from(actual);
  const correct = Buffer.from(expected);
  return incoming.length === correct.length && timingSafeEqual(incoming, correct);
}
function validId(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new DemoError('Unknown demo session', 404);
}

/** Local rehearsal storage. One server process; no production/clinical-data guarantee. */
export class PrescriptionDemoStore {
  private locks = new Map<string, Promise<void>>();
  constructor(private directory = process.env.PRESCRIPTION_STORE_DIR || path.join(process.cwd(), '.local', 'prescription-demo')) {}

  private async read(id: string): Promise<StoredCase> {
    validId(id);
    let data: StoredCase;
    try { data = JSON.parse(await readFile(path.join(this.directory, `${id}.json`), 'utf8')); }
    catch { throw new DemoError('This demo session was not found. Create a new live room.', 404); }
    if (Date.now() - Date.parse(data.session.createdAt) > 4 * 60 * 60 * 1000) throw new DemoError('This rehearsal session expired. Create a new room.', 410);
    return data;
  }

  private async save(data: StoredCase) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = path.join(this.directory, `${data.session.id}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, destination);
  }

  private async mutate<T>(id: string, action: (data: StoredCase) => Promise<T> | T): Promise<T> {
    validId(id);
    const before = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const tail = before.catch(() => undefined).then(() => waiting);
    this.locks.set(id, tail);
    await before.catch(() => undefined);
    try {
      const data = await this.read(id);
      const result = await action(data);
      await this.save(data);
      return result;
    } finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  async create() {
    const now = new Date().toISOString();
    const token = () => randomBytes(24).toString('hex');
    const data: StoredCase = {
      session: { id: randomUUID(), mode: 'live', title: 'One prescription. Three stories.', createdAt: now, updatedAt: now, events: [] },
      operatorToken: token(), sourceTokens: { pharmacy: token(), insurer: token(), clinic: token() }, phoneCalls: {},
    };
    await this.save(data);
    return {
      session: data.session,
      operatorToken: data.operatorToken,
      sourceLinks: Object.fromEntries(Object.entries(data.sourceTokens).map(([role, secret]) => [role,
        `/prescription/source?sessionId=${data.session.id}&role=${role}&token=${secret}`])) as Record<SourceRole, string>,
    };
  }

  private authorize(data: StoredCase, token: string, role?: SourceRole) {
    if (!token) throw new DemoError('This room needs its private session link.', 401);
    if (role) {
      if (!matches(token, data.sourceTokens[role])) throw new DemoError('This link cannot speak for that source.', 403);
    } else if (!matches(token, data.operatorToken) && !Object.values(data.sourceTokens).some((secret) => matches(token, secret))) {
      throw new DemoError('Invalid session access.', 403);
    }
  }

  async get(id: string, token: string) {
    const data = await this.read(id);
    this.authorize(data, token);
    return data.session;
  }

  async evidence(id: string, token: string, role: SourceRole, kind: EvidenceKind, text: string) {
    return this.mutate(id, (data) => {
      this.authorize(data, token, role);
      this.append(data, role, kind, text, 'live-source');
      return data.session;
    });
  }

  private append(data: StoredCase, role: SourceRole, kind: EvidenceKind, text: string, origin: CaseEvidence['origin'], callId?: string) {
    if (!kindAllowedForRole(role, kind)) throw new DemoError('This source cannot confirm that event.', 403);
    if (data.session.events.length >= 150) throw new DemoError('This rehearsal has reached its event limit. Start a new room.', 429);
    const revision = Math.max(0, ...data.session.events.filter((event) => event.role === role).map((event) => event.revision)) + 1;
    const createdAt = new Date().toISOString();
    const event: CaseEvidence = { id: randomUUID(), role, kind, text: text.trim().slice(0, 1200), createdAt, revision, origin, ...(callId ? { callId } : {}) };
    data.session.events = appendCaseEvidence(data.session.events, event);
    data.session.updatedAt = createdAt;
  }

  async claimPhone(id: string, token: string, role: SourceRole): Promise<{ created: boolean; call?: PhoneAttempt }> {
    return this.mutate(id, (data) => {
      if (!matches(token, data.operatorToken)) throw new DemoError('Only the presenter can start a call.', 403);
      if (data.phoneCalls[role]) return { created: false, call: data.phoneCalls[role] };
      data.phoneCalls[role] = { status: 'dispatching' };
      return { created: true };
    });
  }

  async finishPhone(id: string, role: SourceRole, callId?: string) {
    return this.mutate(id, (data) => {
      data.phoneCalls[role] = callId ? { status: 'queued', callId } : { status: 'unknown' };
    });
  }

  async phoneEvidence(id: string, role: SourceRole, callId: string, kind: EvidenceKind, text: string) {
    return this.mutate(id, (data) => {
      if (data.phoneCalls[role]?.callId !== callId) throw new DemoError('This call is not registered to that source room.', 403);
      // The tool is retry-free, but suppress duplicate source statements too.
      if (data.session.events.some((event) => event.callId === callId && event.kind === kind && event.text === text.trim())) return data.session;
      this.append(data, role, kind, text, 'retell', callId);
      return data.session;
    });
  }
}

const globalStore = globalThis as typeof globalThis & { prescriptionDemoStore?: PrescriptionDemoStore };
export const prescriptionStore = globalStore.prescriptionDemoStore ??= new PrescriptionDemoStore();
