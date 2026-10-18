import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DemoError, prescriptionStore } from '@/lib/prescription/store';
import { dialPrescriptionSource, phoneReadiness } from '@/lib/prescription/phone';
import { failure, json, readBody, requireDemoEnabled, tokenFrom } from '@/lib/prescription/http';

export const maxDuration = 45;
const Body = z.object({ role: z.enum(['pharmacy', 'insurer', 'clinic']), consent: z.literal(true) }).strict();
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireDemoEnabled();
    const expected = Buffer.from(process.env.PRESCRIPTION_DEMO_CALL_TOKEN ?? '');
    const supplied = Buffer.from(req.headers.get('x-prescription-call-token') ?? '');
    if (expected.length < 24 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new DemoError('Real phone calls require the private presenter call token.', 403);
    const parsed = Body.safeParse(await readBody(req));
    if (!parsed.success) throw new DemoError('Choose a source and confirm the participant consented to this roleplay call.');
    if (!phoneReadiness().ready) throw new DemoError('Retell phone calling is not configured. The live source rooms remain available.', 503);
    const { id } = await context.params;
    const { role } = parsed.data;
    const claim = await prescriptionStore.claimPhone(id, tokenFrom(req), role);
    if (!claim.created) {
      if (claim.call?.callId) return json({ callId: claim.call.callId, duplicate: true });
      throw new DemoError('A call was already requested for this source. Its status is uncertain; do not dial again.', 409);
    }
    try {
      const result = await dialPrescriptionSource({ sessionId: id, role });
      await prescriptionStore.finishPhone(id, role, result.callId);
      return json(result);
    } catch {
      await prescriptionStore.finishPhone(id, role).catch(() => undefined);
      throw new DemoError('The call request could not be confirmed. No automatic retry will be made.', 502);
    }
  } catch (error) { return failure(error); }
}
