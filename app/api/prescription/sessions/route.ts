import { prescriptionStore, DemoError } from '@/lib/prescription/store';
import { failure, json, readBody, requireDemoEnabled } from '@/lib/prescription/http';

export async function POST(req: Request) {
  try {
    requireDemoEnabled();
    const body = await readBody(req) as { syntheticDataOnly?: unknown };
    if (!body || body.syntheticDataOnly !== true) throw new DemoError('Live rehearsal uses fictional case details only.');
    return json(await prescriptionStore.create(), 201);
  } catch (error) { return failure(error); }
}
