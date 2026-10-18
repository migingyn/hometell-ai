import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Mode = 'daily' | 'crisis';
export type Status = 'queued' | 'calling' | 'ok' | 'needs_human' | 'no_answer' | 'handled';
export type Tone = 'red' | 'amber' | 'mint' | 'blue' | 'muted';
export type PublicClient = { id: string; name: string; risk_tier: 'red' | 'yellow' | 'green'; lives_alone: boolean; uses_powered_equipment: boolean; emergency_contact_name: string; language?: string; needs_ride?: boolean; last_daily_at?: string | null; lat?: number | null; lng?: number | null };
export type LiveCheck = { id: string; client_id: string; event_id: string; status: Status; ladder_step: number; urgency: 'urgent' | 'follow_up' | null; summary: string | null; flag_reason: string | null; sms_status: string | null; next_action_at: string | null; updated_at: string };
export type LiveEvent = { id: string; type: string; started_at: string; alert_text: string | null };
export type MapPerson = { client: PublicClient; check: LiveCheck | null };
export type Feed = { event: LiveEvent | null; people: MapPerson[]; fetchedAt: string };

let db: SupabaseClient | null = null;
export function liveDatabase() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('Live map not connected. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the map server. No live client positions are being displayed.');
  if (!db) db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return db;
}

export async function readFeed(eventId?: string | null): Promise<Feed> {
  const source = liveDatabase();
  const signal = AbortSignal.timeout(6500);
  const [clientResponse, eventResponse] = await Promise.all([
    source.from('clients_public').select('*').abortSignal(signal),
    eventId === null ? Promise.resolve({ data: null, error: null })
      : eventId === undefined ? source.from('events').select('*').order('started_at', { ascending: false }).limit(1).abortSignal(signal).maybeSingle()
        : source.from('events').select('*').eq('id', eventId).abortSignal(signal).maybeSingle(),
  ]);
  if (clientResponse.error || eventResponse.error) throw new Error('The live client feed could not be read. Check database availability and read-only access to clients_public, events, and checks.');
  const event = eventResponse.data as LiveEvent | null;
  const checks = event ? await source.from('checks').select('*').eq('event_id', event.id).abortSignal(signal) : { data: [], error: null };
  if (checks.error) throw new Error('The current check-in records could not be read. Previously loaded records may be out of date.');
  const byClient = new Map(((checks.data ?? []) as LiveCheck[]).map((check) => [check.client_id, check]));
  return { event, people: ((clientResponse.data ?? []) as PublicClient[]).map((client) => ({ client, check: byClient.get(client.id) ?? null })), fetchedAt: new Date().toISOString() };
}

export function eventMode(event: LiveEvent | null): Mode { return event?.type === 'daily' ? 'daily' : 'crisis'; }
export function personState(person: MapPerson, mode: Mode): { label: string; tone: Tone; rank: number } {
  if (!person.check) return { label: 'Not yet checked', tone: 'muted', rank: 4 };
  const check = person.check;
  switch (check.status) {
    case 'needs_human': return mode === 'crisis' || check.urgency === 'urgent' ? { label: 'Needs human review', tone: 'red', rank: 0 } : { label: 'Follow up', tone: 'amber', rank: 1 };
    case 'no_answer': return { label: 'No answer · following up', tone: 'amber', rank: 2 };
    case 'calling': return { label: 'Calling now', tone: 'blue', rank: 3 };
    case 'queued': return { label: 'Queued', tone: 'muted', rank: 4 };
    case 'ok': return { label: 'Confirmed okay', tone: 'mint', rank: 5 };
    case 'handled': return { label: 'Handled by a person', tone: 'muted', rank: 6 };
  }
}
export function hasCoordinates(person: MapPerson): boolean {
  const { lat, lng } = person.client;
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}
