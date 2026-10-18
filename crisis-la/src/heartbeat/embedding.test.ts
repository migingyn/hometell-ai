import { describe, expect, it } from 'vitest';
import { allowedParentOrigin, focusMessage } from './embedding';

describe('map dashboard bridge', () => {
  it('trusts only the configured origin in production', () => {
    expect(allowedParentOrigin('https://agency.example', 'https://agency.example/dashboard', false)).toBe('https://agency.example');
    for (const origin of ['https://agency.example.evil.test', 'https://evil.test', 'https://user@agency.example', 'https://agency.example/path', 'null', 'http://127.0.0.1:3018']) {
      expect(allowedParentOrigin(origin, 'https://agency.example', false)).toBeNull();
    }
  });
  it('permits only the two local dashboard ports during development', () => {
    expect(allowedParentOrigin('http://127.0.0.1:3018', undefined, true)).toBe('http://127.0.0.1:3018');
    expect(allowedParentOrigin('http://localhost:3017', undefined, true)).toBe('http://localhost:3017');
    expect(allowedParentOrigin('http://localhost:3019', undefined, true)).toBeNull();
    expect(allowedParentOrigin('http://127.0.0.1.evil.test:3018', undefined, true)).toBeNull();
  });
  it('validates focus IDs and distinguishes omitted visibility from an empty filter', () => {
    expect(focusMessage({ type: 'heartbeat:focus', clientId: null })).toEqual({ type: 'heartbeat:focus', clientId: null });
    expect(focusMessage({ type: 'heartbeat:focus', clientId: 'patient-a', visibleClientIds: [] })?.visibleClientIds).toEqual([]);
    expect(focusMessage({ type: 'heartbeat:focus', clientId: 'patient-a', visibleClientIds: ['patient-a', 'patient-a'] })?.visibleClientIds).toEqual(['patient-a']);
    expect(focusMessage({ type: 'heartbeat:focus', clientId: 9 })).toBeNull();
    expect(focusMessage({ type: 'heartbeat:focus', clientId: null, visibleClientIds: [null] })).toBeNull();
    expect(focusMessage({ type: 'other', clientId: null })).toBeNull();
  });
  it('accepts only explicit no-event or UUID event selection', () => {
    expect(focusMessage({ type: 'heartbeat:focus', clientId: null, eventId: null })?.eventId).toBeNull();
    const eventId = '6fe169fa-5164-469f-bede-d5ef3d9f1fa8';
    expect(focusMessage({ type: 'heartbeat:focus', clientId: null, eventId })?.eventId).toBe(eventId);
    expect(focusMessage({ type: 'heartbeat:focus', clientId: null, eventId: 'arbitrary-event' })).toBeNull();
  });
});
