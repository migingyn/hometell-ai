import Retell from 'retell-sdk';
import { z } from 'zod';
import { DemoError, prescriptionStore } from '@/lib/prescription/store';
import { failure, json, requireDemoEnabled } from '@/lib/prescription/http';
import type { EvidenceKind } from '@/shared/prescription';

const Payload = z.object({
  name: z.literal('report_source_update'),
  args: z.object({ kind: z.string().max(60), text: z.string().trim().min(8).max(1200) }).strict(),
  call: z.object({ call_id: z.string().min(1).max(200), agent_id: z.string(), metadata: z.object({ prescription_session_id: z.string().uuid(), prescription_role: z.enum(['pharmacy', 'insurer', 'clinic']) }) }),
});
export async function POST(req: Request) {
  try {
    requireDemoEnabled();
    const key = process.env.RETELL_API_KEY;
    if (!key) throw new DemoError('Live Retell callbacks are not configured', 503);
    if (Number(req.headers.get('content-length')) > 262144) throw new DemoError('Request too large', 413);
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 262144) throw new DemoError('Request too large', 413);
    const signature = req.headers.get('x-retell-signature');
    let verified = false;
    try { verified = !!signature && await Retell.verify(raw, key, signature); } catch { /* invalid signature */ }
    if (!verified) throw new DemoError('Invalid signature', 401);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new DemoError('Expected a JSON body'); }
    const parsed = Payload.safeParse(body);
    if (!parsed.success) throw new DemoError('Invalid source update');
    const { call, args } = parsed.data;
    if (call.agent_id !== process.env.RETELL_AGENT_ID) throw new DemoError('Unknown agent', 403);
    await prescriptionStore.phoneEvidence(call.metadata.prescription_session_id, call.metadata.prescription_role, call.call_id, args.kind as EvidenceKind, args.text);
    return json({ recorded: true, message: 'The source statement was recorded with its call receipt. It is not a clinical decision or proof of a real prescription.' });
  } catch (error) { return failure(error); }
}
