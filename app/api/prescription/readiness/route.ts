import { connection } from 'next/server';
import { phoneReadiness } from '@/lib/prescription/phone';
import { json } from '@/lib/prescription/http';

export async function GET() {
  await connection();
  const enabled = process.env.NODE_ENV !== 'production' || process.env.PRESCRIPTION_DEMO_ENABLED === 'true';
  const phone = phoneReadiness();
  if (!process.env.PRESCRIPTION_DEMO_CALL_TOKEN || process.env.PRESCRIPTION_DEMO_CALL_TOKEN.length < 24) phone.missing.push('PRESCRIPTION_DEMO_CALL_TOKEN');
  return json({ liveRooms: enabled, phone: { ready: enabled && phone.ready && phone.missing.length === 0, missing: [...new Set(phone.missing)] } });
}
