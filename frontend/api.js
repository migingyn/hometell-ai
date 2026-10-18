import { supabaseBrowser } from '../lib/supabase-browser';

// Every care screen uses the same persisted roster and checks as crisis outreach.
let selectedFacility = null;
export function setCareFacility(value) { selectedFacility = value; }
export async function request(path, body) {
  let role = '';
  try { role = JSON.parse(sessionStorage.getItem('heartbeat-demo-session') || '{}').role || ''; } catch { /* Login supplies the demo role. */ }
  const headers = {'x-heartbeat-demo-role': role, ...(body === undefined ? {} : {'Content-Type':'application/json'})};
  const url = new URL(path.replace(/^\/api\//, '/api/care/'), window.location.origin);
  let facility = selectedFacility;
  try { facility = sessionStorage.getItem('heartbeat-demo-facility') || null; } catch { /* Use the active in-memory selection. */ }
  if (facility && !url.searchParams.has('facility_id')) url.searchParams.set('facility_id', facility);
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store', signal: AbortSignal.timeout(30000), headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'The care workspace could not save or load this record.');
  return result.data;
}
export function subscribe(onEvent, onConnection) {
  try {
    const db = supabaseBrowser();
    const channel = db.channel('care-workspace').on('postgres_changes', {event:'*',schema:'public',table:'checks'}, onEvent)
      .subscribe(state => onConnection(state === 'SUBSCRIBED'));
    return () => { void db.removeChannel(channel); };
  } catch { onConnection(false); return () => {}; }
}
