import { z } from 'zod';
import { DemoError, prescriptionStore } from '@/lib/prescription/store';
import { failure, json, readBody, requireDemoEnabled, tokenFrom } from '@/lib/prescription/http';
import type { EvidenceKind } from '@/shared/prescription';

const Body = z.object({ role: z.enum(['pharmacy', 'insurer', 'clinic']), kind: z.string().max(60), text: z.string().trim().min(8).max(1200) }).strict();
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireDemoEnabled();
    const parsed = Body.safeParse(await readBody(req));
    if (!parsed.success) throw new DemoError('Choose a source event and provide a brief confirmed statement.');
    const { id } = await context.params;
    const { role, kind, text } = parsed.data;
    return json(await prescriptionStore.evidence(id, tokenFrom(req), role, kind as EvidenceKind, text));
  } catch (error) { return failure(error); }
}
