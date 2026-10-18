export type FocusMessage = { type: 'heartbeat:focus'; clientId: string | null; visibleClientIds?: string[]; eventId?: string | null };

/** A query parameter selects among trusted origins; it never grants trust. */
export function allowedParentOrigin(requested: string | null, configured: string | undefined, development: boolean): string | null {
  if (!requested) return null;
  let candidate: URL;
  try { candidate = new URL(requested); } catch { return null; }
  if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password || requested !== candidate.origin) return null;
  if (configured) {
    try {
      const trusted = new URL(configured);
      if (['http:', 'https:'].includes(trusted.protocol) && !trusted.username && !trusted.password && candidate.origin === trusted.origin) return candidate.origin;
    } catch { /* A malformed setting does not authorize another origin. */ }
  }
  return development && candidate.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname) && ['3017', '3018'].includes(candidate.port)
    ? candidate.origin : null;
}

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
export function focusMessage(value: unknown): FocusMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.type !== 'heartbeat:focus' || (input.clientId !== null && !validId(input.clientId))) return null;
  if (input.visibleClientIds !== undefined && (!Array.isArray(input.visibleClientIds) || input.visibleClientIds.length > 10_000 || !input.visibleClientIds.every(validId))) return null;
  if (input.eventId !== undefined && input.eventId !== null && (typeof input.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.eventId))) return null;
  return { type: 'heartbeat:focus', clientId: input.clientId as string | null,
    ...(input.visibleClientIds === undefined ? {} : { visibleClientIds: [...new Set(input.visibleClientIds as string[])] }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId as string | null }) };
}
