import { DemoError } from './store';

export function tokenFrom(req: Request) {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
}
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown) {
  if (error instanceof DemoError) return json({ error: error.message }, error.status);
  return json({ error: 'The live rehearsal server could not complete this request.' }, 500);
}

export function requireDemoEnabled() {
  if (process.env.NODE_ENV === 'production' && process.env.PRESCRIPTION_DEMO_ENABLED !== 'true') {
    throw new DemoError('Live rehearsal is disabled on this deployment. Start the local demo server.', 503);
  }
}

export async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length')) > 12000) throw new DemoError('Request too large', 413);
  const text = await req.text();
  if (Buffer.byteLength(text) > 12000) throw new DemoError('Request too large', 413);
  try { return JSON.parse(text); } catch { throw new DemoError('A JSON request body is required'); }
}
