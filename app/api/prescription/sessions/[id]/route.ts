import { prescriptionStore } from '@/lib/prescription/store';
import { failure, json, requireDemoEnabled, tokenFrom } from '@/lib/prescription/http';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireDemoEnabled();
    const { id } = await context.params;
    return json(await prescriptionStore.get(id, tokenFrom(req)));
  } catch (error) { return failure(error); }
}
