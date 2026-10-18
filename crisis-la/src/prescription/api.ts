import type { EvidenceKind, PrescriptionCase, SourceRole } from '../../../shared/prescription';

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('The live rehearsal server is offline. Start npm run dev:prescription in the main project folder.'); }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error('Live source rooms need the rehearsal backend. Start npm run dev:prescription in the main project folder.'); }
  if (!response.ok) throw new Error((data as { error?: string }).error || `Request failed (${response.status})`);
  return data as T;
}

export function createLiveSession() {
  return request<{ session: PrescriptionCase; operatorToken: string; sourceLinks: Record<SourceRole, string> }>('/api/prescription/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ syntheticDataOnly: true }),
  });
}
export function getLiveSession(id: string, token: string) {
  return request<PrescriptionCase>(`/api/prescription/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
}
export function submitSourceEvidence(id: string, token: string, role: SourceRole, kind: EvidenceKind, text: string) {
  return request<PrescriptionCase>(`/api/prescription/sessions/${encodeURIComponent(id)}/evidence`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role, kind, text }),
  });
}
export function getReadiness() {
  return request<{ liveRooms: boolean; phone: { ready: boolean; missing: string[] } }>('/api/prescription/readiness');
}
export function dialSource(id: string, token: string, role: SourceRole) {
  const callToken = window.prompt('Enter the private presenter call token configured on the demo server. Only consenting roleplay participants may be called.');
  if (!callToken) return Promise.reject(new Error('Call cancelled. No number was dialed.'));
  return request<{ callId: string }>(`/api/prescription/sessions/${encodeURIComponent(id)}/call`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-prescription-call-token': callToken }, body: JSON.stringify({ role, consent: true }),
  });
}
