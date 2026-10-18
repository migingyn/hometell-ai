import { useCallback, useEffect, useRef, useState } from 'react';
import LiveMapScene from './LiveMapScene';
import { eventMode, hasCoordinates, liveDatabase, personState, readFeed } from './feed';
import type { Feed, MapPerson } from './feed';
import { allowedParentOrigin, focusMessage } from './embedding';
import './heartbeat-map.css';

const dashboardUrl = import.meta.env.VITE_HEARTBEAT_URL || 'http://localhost:3017';
const query = new URLSearchParams(window.location.search);
const embedded = query.get('embed') === '1';
const parentOrigin = embedded ? allowedParentOrigin(query.get('parentOrigin'), import.meta.env.VITE_HEARTBEAT_URL, import.meta.env.DEV) : null;
const steps = ['First call', 'Retry client', 'Text client', 'Emergency contact', 'Human coordinator'];
const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
type Health = { mockMode: boolean; fictionalData: boolean; database: boolean };

export default function HeartbeatMap() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'connecting' | 'realtime' | 'polling'>('connecting');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleClientIds, setVisibleClientIds] = useState<string[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'attention' | 'unreached'>('all');
  const [health, setHealth] = useState<Health | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const generation = useRef(0);
  const requestedEvent = useRef<string | null | undefined>(undefined);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async (): Promise<void> => {
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true;
    const current = ++generation.current;
    const eventId = requestedEvent.current;
    try { const data = await readFeed(eventId); if (alive.current && generation.current === current && requestedEvent.current === eventId) { setFeed(data); setError(''); } }
    catch (err) { if (alive.current && generation.current === current) { setError(err instanceof Error ? err.message : 'The live feed could not be loaded. No simulated client data has been substituted.'); setConnection('polling'); } }
    finally { inFlight.current = false; if (queued.current && alive.current) { queued.current = false; queueMicrotask(() => { void load(); }); } }
  }, []);
  useEffect(() => {
    let active = true;
    alive.current = true;
    const initial = window.setTimeout(() => { void load(); }, 0);
    const grace = window.setTimeout(() => { if (active) setConnection((value) => value === 'connecting' ? 'polling' : value); }, 6000);
    let remove: (() => void) | undefined;
    try {
      const db = liveDatabase();
      const channel = db.channel('heartbeat-live-map')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'checks' }, () => { if (active) void load(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => { if (active) void load(); })
        .subscribe((status) => { if (!active) return; if (status === 'SUBSCRIBED') { setConnection('realtime'); void load(); } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setConnection('polling'); });
      remove = () => { void db.removeChannel(channel); };
    } catch { queueMicrotask(() => { if (active) setConnection('polling'); }); }
    void fetch('/api/health', { cache: 'no-store' }).then((response) => response.json()).then((result: { ok: boolean; data?: Health }) => { if (active && result.ok && result.data) setHealth(result.data); }).catch(() => undefined);
    return () => { active = false; alive.current = false; queued.current = false; window.clearTimeout(initial); window.clearTimeout(grace); remove?.(); };
  }, [load]);
  useEffect(() => { if (connection !== 'polling') return; const interval = window.setInterval(() => { void load(); }, 3000); return () => window.clearInterval(interval); }, [connection, load]);
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReducedMotion(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => {
    if (!embedded || !parentOrigin || window.parent === window) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const message = focusMessage(event.data);
      if (!message) return;
      if (message.eventId !== undefined && message.eventId !== requestedEvent.current) {
        requestedEvent.current = message.eventId;
        generation.current++;
        setFeed(null);
        setError('');
        void load();
      }
      setSelectedId(message.clientId);
      if (message.visibleClientIds !== undefined) setVisibleClientIds(message.visibleClientIds);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'heartbeat:ready' }, parentOrigin);
    return () => window.removeEventListener('message', receive);
  }, [load]);

  const mode = eventMode(feed?.event ?? null);
  const people = feed?.people ?? [];
  const selected = people.find((person) => person.client.id === selectedId) ?? null;
  const tier = { red: 0, yellow: 1, green: 2 };
  const roster = [...people].filter((person) => filter === 'attention' ? person.check?.status === 'needs_human' : filter === 'unreached' ? !person.check || ['no_answer', 'queued', 'calling'].includes(person.check.status) : true).sort((a, b) => personState(a, mode).rank - personState(b, mode).rank || tier[a.client.risk_tier] - tier[b.client.risk_tier] || (mode === 'crisis' ? Number(Boolean(b.client.needs_ride)) - Number(Boolean(a.client.needs_ride)) || Number(b.client.lives_alone) - Number(a.client.lives_alone) : 0) || a.client.name.localeCompare(b.client.name));
  const urgent = people.filter((person) => personState(person, mode).tone === 'red').length;
  const okay = people.filter((person) => person.check?.status === 'ok').length;
  const unreached = people.filter((person) => !person.check || ['no_answer', 'calling', 'queued'].includes(person.check.status)).length;
  const ride = people.filter((person) => person.client.needs_ride).length;
  const total = (value: number) => feed ? String(value).padStart(2, '0') : '—';
  if (embedded) {
    const visible = visibleClientIds === null ? null : new Set(visibleClientIds);
    const mapPeople = people.filter((person) => person.check && (!visible || visible.has(person.client.id)));
    const select = (clientId: string | null) => {
      if (clientId !== null && !mapPeople.some((person) => person.client.id === clientId)) return;
      setSelectedId(clientId);
      if (parentOrigin && window.parent !== window) window.parent.postMessage({ type: 'heartbeat:select', clientId }, parentOrigin);
    };
    return <main className={`hm-app hm-embedded hm-mode-${mode}`} aria-label="Patient check-in map">
      <section className="hm-map-stage">
        <LiveMapScene people={mapPeople} mode={mode} selectedId={selectedId} onSelect={select} reducedMotion={reducedMotion} />
        <div className="hm-embed-feed" aria-live="polite"><i className={connection === 'realtime' ? 'hm-connected' : ''} />{!feed ? 'SYNCING CHECK-IN MAP' : connection === 'realtime' ? 'LIVE CHECK-IN FEED' : connection === 'polling' ? 'UPDATING EVERY 3 SECONDS' : 'CONNECTING TO CHECK-INS'}<span>FICTIONAL POSITIONS</span></div>
        {error && <div className="hm-feed-error" role="alert"><strong>{feed ? 'Map updates interrupted' : 'Map feed unavailable'}</strong><p>{feed ? `Showing records received at ${clock(feed.fetchedAt)}.` : error}</p><button onClick={() => { void load(); }}>Retry map feed ↗</button></div>}
        {!error && feed && !mapPeople.some(hasCoordinates) && <div className="hm-feed-note">{mapPeople.length ? 'These patients have no recorded map position. Their check-in details remain in the dashboard.' : 'No patients with map positions in this view.'}</div>}
        {embedded && !parentOrigin && <div className="hm-embed-unlinked">Dashboard connection unavailable · parent origin is not authorized.</div>}
      </section>
    </main>;
  }
  return <main className={`hm-app hm-mode-${mode}`}>
    <header className="hm-header"><a href={dashboardUrl} className="hm-brand"><span>♡</span>heartbeat<i>.</i></a><span className="hm-header-title">THE PEOPLE BEHIND THE PINS</span><div className="hm-header-right"><span className="hm-fictional">FICTIONAL POSITIONS</span><span className={`hm-mock ${health?.mockMode ? '' : 'hm-neutral-badge'}`}>{health ? health.mockMode ? 'MOCK CALLS · LIVE DATABASE' : 'LIVE DATABASE · CALL MODE REAL' : 'CALL MODE UNVERIFIED'}</span><a className="hm-dashboard-link" href={dashboardUrl}>Open call dashboard<span>↗</span></a></div></header>
    <div className="hm-experience"><section className="hm-map-stage"><LiveMapScene people={people} mode={mode} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} /><div className="hm-map-intro"><div className="hm-eyebrow"><i />WEST ALTADENA / LOS ANGELES</div><h1>{feed?.event ? mode === 'daily' ? <>Everyday care.<br /><span>Close to home.</span></> : <>Every person.<br /><span>Keep reaching out.</span></> : <>A real phone tree.<br /><span>A shared view.</span></>}</h1><p>{feed?.event ? mode === 'daily' ? 'Morning check-ins, ordinary requests, and a person for every concern.' : 'One official alert. Highest risk first. Human follow-through where it matters.' : 'Connect the enrolled client list and current check-ins. No generated reports or invented status.'}</p><div className="hm-mode-tag">{feed?.event ? mode === 'daily' ? '☀ MORNING CHECK-INS' : '◔ CRISIS RESPONSE' : feed ? 'NO ACTIVE CHECK-IN' : 'CHECK-IN STATUS UNVERIFIED'}{feed?.event && <span>Started {clock(feed.event.started_at)}</span>}</div></div><div className="hm-map-metrics"><div><strong>{total(urgent)}</strong><span>Need a person now</span></div><div><strong>{total(okay)}</strong><span>Confirmed okay</span></div><div><strong>{total(unreached)}</strong><span>Not yet reached</span></div><div><strong>{total(ride)}</strong><span>Need a ride</span></div></div>{error && <div className="hm-feed-error" role="alert"><strong>{feed ? 'Live updates interrupted' : 'Live feed not connected'}</strong><p>{error}</p>{feed && <span>Showing last received records from {clock(feed.fetchedAt)}. Current status may have changed.</span>}<button onClick={() => { void load(); }}>Retry live feed ↗</button></div>}{!error && feed && !people.some(hasCoordinates) && <div className="hm-feed-note">{people.length ? 'Clients are loaded, but none have usable coordinates. The roster remains available.' : 'The live database has no enrolled clients. No pins have been generated.'}</div>}</section>
      <aside className="hm-sidebar"><div className="hm-feed-status"><span><i className={connection === 'realtime' ? 'hm-connected' : ''} />{connection === 'realtime' ? 'LIVE SUPABASE FEED' : connection === 'polling' ? 'POLLING FALLBACK · 3 SECONDS' : 'CONNECTING TO SUPABASE'}</span><span>{feed ? clock(feed.fetchedAt) : '—'}</span></div><div className="hm-roster-heading"><div className="hm-eyebrow">YOUR ENROLLED CLIENTS</div><h2>{selected ? 'Client details' : <>A person for<br />every concern.</>}<span>{feed ? people.length : '—'}</span></h2><p>Read-only view of the same check-ins as the coordinator’s dashboard.</p></div><div className="hm-roster-filters">{([['all', 'Everyone'], ['attention', 'Needs a person'], ['unreached', 'Unreached']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {selected && <SelectedPerson person={selected} mode={mode} onClose={() => setSelectedId(null)} />}
      <div className="hm-roster-list">{roster.map((person) => { const state = personState(person, mode); return <button className={`hm-roster-person hm-tone-${state.tone} ${selectedId === person.client.id ? 'hm-roster-selected' : ''}`} onClick={() => setSelectedId(person.client.id)} key={person.client.id}><span className="hm-roster-avatar">{person.client.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span className="hm-roster-person-info"><strong>{person.client.name}</strong><span><i />{state.label}</span><small>{person.client.needs_ride ? 'Needs a ride · ' : ''}{person.client.risk_tier === 'red' ? 'High priority' : person.client.risk_tier === 'yellow' ? 'Medium priority' : 'Standard priority'}{!hasCoordinates(person) ? ' · No position' : ''}</small></span><span className="hm-roster-arrow">↗</span></button>; })}{!roster.length && <div className="hm-roster-empty"><span>⌁</span><strong>{people.length ? 'No clients in this view.' : error ? 'No live records to display.' : 'Waiting for the enrolled list.'}</strong><p>{people.length ? 'Choose Everyone to see the full roster.' : 'No fictional stand-ins are added when the feed is unavailable.'}</p></div>}</div>
      <footer className="hm-sidebar-footer"><span>◇</span><div><strong>Positions are deliberately approximate.</strong><p>Fictional client coordinates, not real homes. Statuses come from current database records. Confirmed okay is a reported response, not a safety determination.</p></div></footer></aside></div>
    <footer className="hm-bottom"><span><i />Read-only live client feed<span>·</span>Phone numbers stay private</span><span>Fictional positions around west Altadena · no evacuation or medical decisions</span><a href="/">Open the original replay ↗</a></footer>
  </main>;
}

function SelectedPerson({ person, mode, onClose }: { person: MapPerson; mode: 'daily' | 'crisis'; onClose(): void }) {
  const { client, check } = person;
  const state = personState(person, mode);
  return <section className={`hm-selected hm-tone-${state.tone}`}><header><span>SELECTED CLIENT</span><button aria-label="Close selected client" onClick={onClose}>×</button></header><h3>{client.name}</h3><span className="hm-selected-status"><i />{state.label}</span><div className="hm-selected-facts">{client.lives_alone && <span>Lives alone</span>}{client.uses_powered_equipment && <span>Powered equipment</span>}{client.needs_ride && <span>Needs a ride</span>}{client.language && client.language !== 'en' && <span>{client.language === 'es' ? 'Spanish requested' : client.language === 'ko' ? 'Korean requested' : `${client.language} requested`}</span>}</div><blockquote>{check?.flag_reason || check?.summary || 'No confirmed response has been recorded for this client in the latest check-in.'}</blockquote>{check?.flag_reason && check.summary && <p className="hm-selected-summary">{check.summary}</p>}{check && <><div className="hm-selected-ladder"><span>FOLLOW-UP LADDER · STEP {check.ladder_step} / 4</span><ol>{steps.map((step, index) => <li key={step} className={index === check.ladder_step ? 'hm-step-current' : index < check.ladder_step ? 'hm-step-past' : ''}><i>{index < check.ladder_step ? '✓' : index + 1}</i><span>{step}</span></li>)}</ol></div>{check.sms_status && <p className="hm-selected-sms">{check.sms_status}</p>}<div className="hm-selected-updated">Updated {clock(check.updated_at)}{check.next_action_at && <span>Next step {clock(check.next_action_at)}</span>}</div></>}<small>{hasCoordinates(person) ? 'Fictional position · approximate, not an actual home' : 'This client has no usable position; no map pin is displayed.'}</small></section>;
}
