import { fail, ok } from '@/lib/api';
import { careRequest, CareError } from '@/lib/care/service';

async function handle(req: Request, ctx: {params: Promise<{path: string[]}>}) {
  // Demo role selection is presentation only. Keep the merged adapter local and
  // mocked until real authentication and server-side memberships are implemented.
  const url = new URL(req.url);
  let database: URL;
  try { database = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || ''); }
  catch { return fail('Local Supabase is not configured.', 503); }
  const local = (host: string) => ['localhost','127.0.0.1','[::1]'].includes(host);
  if (process.env.NODE_ENV === 'production' || process.env.MOCK_RETELL !== 'true' || !local(url.hostname) || !local(database.hostname)) return fail('The demo care API requires a local mock environment.', 403);
  if (req.headers.get('origin') && req.headers.get('origin') !== url.origin) return fail('Use the same-origin care workspace.',403);
  const role = req.headers.get('x-heartbeat-demo-role');
  if (role !== 'administrator' && role !== 'nurse') return fail('Open the demo login and choose a workspace.',403);
  try {
    const body = req.method === 'POST' ? await req.json() : undefined;
    return ok(await careRequest((await ctx.params).path,body,role,url));
  } catch(error) {
    if(error instanceof CareError) return fail(error.message,error.status);
    if(error instanceof SyntaxError) return fail('Body is not valid JSON.');
    return fail('The care workspace could not complete this request. Check local Supabase and the care migration.',500);
  }
}
export const GET = handle;
export const POST = handle;
