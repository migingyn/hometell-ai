import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseEvidence, EvidenceKind, PrescriptionCase, SourceRole } from '../../../shared/prescription';
import { SOURCE_ROLES } from '../../../shared/prescription';
import { appendCaseEvidence, deriveCase } from '../../../shared/prescription-engine';
import { SOURCE_BRIEFS, REPLAY_BEATS, REPLAY_DURATION, createReplayCase } from '../../../shared/prescription-scenario';
import { createLiveSession, dialSource, getLiveSession, getReadiness, submitSourceEvidence } from './api';
import './prescription.css';

const roleLabel: Record<SourceRole, string> = { pharmacy: 'Pharmacy', insurer: 'Insurer', clinic: 'Clinic' };
const LIVE_ROOM_STORAGE = 'sourcecheck.prescription.live-room.v1';
type IconName = 'arrow' | 'check' | 'play' | 'pause' | 'reset' | 'quote' | 'close' | 'phone' | 'external' | 'mic' | 'sound' | 'link' | 'shield';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    quote: <><path d="M4 6h6v7H6l-2 5M14 6h6v7h-4l-2 5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    phone: <path d="M7 3H4c-1 0-1 3 0 6 2 5 6 9 11 11 3 1 6 1 6 0v-4l-5-2-2 3c-4-2-6-4-8-8l3-2Z" />,
    external: <><path d="M14 3h7v7M21 3 11 13M10 4H4v16h16v-6" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
    sound: <><path d="m4 9 5 0 5-5v16l-5-5H4Z M18 8a6 6 0 0 1 0 8M21 5a10 10 0 0 1 0 14" /></>,
    link: <><path d="m9 15 6-6M9 8l3-3a5 5 0 0 1 7 7l-3 3M15 16l-3 3a5 5 0 0 1-7-7l3-3" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not complete.';
const stamp = (event: CaseEvidence) => new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Brand() {
  return <a className="rx-brand" href="/prescription" aria-label="Sourcecheck prescription home"><span className="rx-brand-mark"><i /><i /><i /></span>sourcecheck<span className="rx-brand-divider" /> <span className="rx-brand-sub">every handoff, accounted for.</span></a>;
}

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };

function SourceRoom({ sessionId, token, role }: { sessionId: string; token: string; role: SourceRole }) {
  const brief = SOURCE_BRIEFS[role];
  const [room, setRoom] = useState<PrescriptionCase | null>(null);
  const [kind, setKind] = useState<EvidenceKind>(brief.options[0].kind);
  const [text, setText] = useState(brief.options[0].text);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  useEffect(() => {
    let active = true;
    let polling = false;
    const read = async () => {
      if (polling) return;
      polling = true;
      try {
        const data = await getLiveSession(sessionId, token);
        if (active) { setRoom((previous) => previous && previous.events.length > data.events.length ? previous : data); setError(''); }
      } catch (err) { if (active) setError(errorText(err)); }
      finally { polling = false; }
    };
    void read();
    const interval = window.setInterval(read, 1000);
    return () => { active = false; window.clearInterval(interval); recognition.current?.stop(); };
  }, [sessionId, token]);
  const dictate = () => {
    if (listening) { recognition.current?.stop(); return; }
    const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) { setError('Voice dictation is not supported in this browser. You can type your source statement below.'); return; }
    const instance = new Constructor();
    instance.lang = 'en-US'; instance.continuous = false; instance.interimResults = false;
    instance.onresult = (event) => { const value = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' '); setText(value); setNotice('Browser dictation captured. Review the statement before submitting.'); };
    instance.onerror = (event) => { setError(event.error === 'not-allowed' ? 'Microphone permission was denied. Type your statement instead.' : `Browser dictation stopped (${event.error}). Type your statement instead.`); setListening(false); };
    instance.onend = () => setListening(false);
    recognition.current = instance;
    try { instance.start(); setListening(true); setError(''); } catch { setError('Microphone dictation could not start. Type your statement instead.'); }
  };
  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    try { const data = await submitSourceEvidence(sessionId, token, role, kind, text); setRoom(data); setNotice('Statement saved by the server. The shared case room has your update.'); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const latest = room?.events.filter((event) => event.role === role).at(-1);
  return <div className="rx-app rx-source-page">
    <header className="rx-header"><Brand /><span className="rx-live-label"><span /> Live participant room</span></header>
    <main className="rx-source-main">
      <div className="rx-eyebrow">YOUR SOURCE MATTERS <span> / {roleLabel[role].toUpperCase()}</span></div>
      <h1>You have one part<br />of the story.</h1>
      <p className="rx-source-lead">Share what your organization can confirm. The shared case will connect it to everyone else’s account.</p>
      <div className={`rx-role-brief rx-role-${role}`}><span className="rx-avatar">{brief.initials}</span><div><strong>{brief.name}</strong><small>{brief.label}</small></div></div>
      <p className="rx-source-instruction">{brief.instruction}</p>
      <section className="rx-source-form">
        <label htmlFor="rx-source-kind">What can you confirm?</label>
        <select id="rx-source-kind" value={kind} onChange={(event) => { const choice = brief.options.find((item) => item.kind === event.target.value)!; setKind(choice.kind); setText(choice.text); setNotice(''); }}>{brief.options.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select>
        <div className="rx-form-label"><label htmlFor="rx-source-quote">Your exact source statement</label><button className={`rx-text-button ${listening ? 'rx-listening' : ''}`} onClick={dictate}><Icon name="mic" size={15} />{listening ? 'Stop dictation' : 'Browser dictation'}</button></div>
        <textarea id="rx-source-quote" rows={5} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} />
        <p className="rx-input-hint">Fictional administrative case only. No patient names, medicine details, or real health information.</p>
        <button className="rx-button rx-button-primary rx-submit" disabled={busy || !text.trim() || !room} onClick={submit}>{busy ? 'Saving statement…' : 'Send source update'}<Icon name="arrow" /></button>
        {notice && <p className="rx-notice" role="status"><Icon name="check" />{notice}</p>}{error && <p className="rx-error" role="alert">{error}</p>}
      </section>
      {latest && <div className="rx-last-receipt"><div className="rx-eyebrow">LATEST SAVED RECEIPT · REVISION {latest.revision}</div><blockquote>“{latest.text}”</blockquote><small>{stamp(latest)} · Live participant submission</small></div>}
      <footer className="rx-source-foot"><Icon name="shield" size={15} />Your private link can only submit updates for the {roleLabel[role].toLowerCase()}.</footer>
    </main>
  </div>;
}

export default function CaseRoom() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const sourceRole = params.get('role');
  if (window.location.pathname.includes('/source')) {
    if (!SOURCE_ROLES.includes(sourceRole as SourceRole) || !params.get('sessionId') || !params.get('token')) {
      return <div className="rx-app"><header className="rx-header"><Brand /></header><main className="rx-source-main"><h1>This room link<br />is incomplete.</h1><p>Ask the case organizer for your private pharmacy, insurer, or clinic link.</p><a className="rx-button rx-button-primary" href="/prescription">Open the case room<Icon name="arrow" /></a></main></div>;
    }
    return <SourceRoom sessionId={params.get('sessionId')!} token={params.get('token')!} role={sourceRole as SourceRole} />;
  }
  return <OperatorRoom />;
}

function OperatorRoom() {
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const [extraEvents, setExtraEvents] = useState<CaseEvidence[]>([]);
  const [live, setLive] = useState<Awaited<ReturnType<typeof createLiveSession>> | null>(null);
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof getReadiness>> | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [callBusy, setCallBusy] = useState<SourceRole | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<{ title: string; ids: string[] } | null>(null);
  const [consent, setConsent] = useState(false);
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const lastSpoken = useRef('');
  const room = useMemo(() => mode === 'live' ? live?.session ?? null : {
    ...createReplayCase(elapsed), events: extraEvents.reduce(appendCaseEvidence, createReplayCase(elapsed).events),
  }, [mode, live, elapsed, extraEvents]);
  const events = room?.events ?? [];
  const snapshot = useMemo(() => deriveCase(events), [room]);
  const currentBeat = [...REPLAY_BEATS].reverse().find((beat) => beat.at <= elapsed);
  const lastEvent = events.at(-1);
  const resolved = snapshot.status === 'ready';
  const accepted = [...events].reverse().find((event) => event.kind === 'clinic_accepted');
  const currentClinicKind = snapshot.latestByRole.clinic?.kind;
  const promiseLabel = currentClinicKind === 'promise_overdue' ? 'MISSED COMMITMENT · FOLLOW UP' : accepted && !['clinic_accepted', 'clinic_resent'].includes(currentClinicKind ?? '') ? 'EARLIER COMMITMENT · RECONFIRM' : 'ACCEPTED PROMISE';
  const conflict = snapshot.conflicts[0];
  const viewEvidence = (title: string, ids: string[]) => setDetail({ title, ids });

  useEffect(() => {
    if (!running || mode !== 'replay') return;
    let last = performance.now();
    const interval = window.setInterval(() => { const now = performance.now(); const delta = (now - last) / 1000; last = now; setElapsed((value) => Math.min(REPLAY_DURATION, value + delta)); }, 100);
    return () => window.clearInterval(interval);
  }, [running, mode]);
  useEffect(() => { if (elapsed >= REPLAY_DURATION) setRunning(false); }, [elapsed]);
  useEffect(() => {
    let active = true;
    try {
      const raw = window.sessionStorage.getItem(LIVE_ROOM_STORAGE);
      if (!raw) return;
      const saved = JSON.parse(raw) as { sessionId?: unknown; operatorToken?: unknown; sourceLinks?: Record<string, unknown> };
      if (typeof saved.sessionId !== 'string' || typeof saved.operatorToken !== 'string' || !SOURCE_ROLES.every((role) => typeof saved.sourceLinks?.[role] === 'string')) {
        window.sessionStorage.removeItem(LIVE_ROOM_STORAGE);
        return;
      }
      const operatorToken = saved.operatorToken;
      const sourceLinks = saved.sourceLinks as Record<SourceRole, string>;
      setMode('live'); setRestoring(true);
      void getLiveSession(saved.sessionId, operatorToken).then((session) => {
        if (active) { setLive({ session, operatorToken, sourceLinks }); setNotice('Live room reconnected. Its current source record was loaded from the server.'); }
      }).catch((err) => { if (active) setError(`Could not reconnect the saved room. ${errorText(err)}`); })
        .finally(() => { if (active) setRestoring(false); });
    } catch { if (active) setError('The saved room could not be restored. Create a new live room to continue.'); }
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!live) return;
    try { window.sessionStorage.setItem(LIVE_ROOM_STORAGE, JSON.stringify({ sessionId: live.session.id, operatorToken: live.operatorToken, sourceLinks: live.sourceLinks })); }
    catch { setNotice('This browser could not save your room for refresh. Keep this tab open while using the live room.'); }
  }, [live?.session.id, live?.operatorToken]);
  useEffect(() => {
    let active = true;
    void getReadiness().then((data) => { if (active) setReadiness(data); }).catch(() => { if (active) setReadiness(null); });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    if (mode !== 'live' || !live) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try { const session = await getLiveSession(live.session.id, live.operatorToken); if (active) { setLive((value) => value ? { ...value, session } : null); setError(''); } }
      catch (err) { if (active) setError(errorText(err)); }
      finally { polling = false; }
    };
    const interval = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [mode, live?.session.id, live?.operatorToken]);
  useEffect(() => {
    if (detail && !evidenceDialog.current?.open) evidenceDialog.current?.showModal();
    if (!detail && evidenceDialog.current?.open) evidenceDialog.current?.close();
  }, [detail]);
  useEffect(() => {
    if (!spoken || mode !== 'replay' || !lastEvent || lastSpoken.current === lastEvent.id || !('speechSynthesis' in window)) return;
    lastSpoken.current = lastEvent.id;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${roleLabel[lastEvent.role]}. ${lastEvent.text}`);
    utterance.rate = 1.04;
    window.speechSynthesis.speak(utterance);
  }, [spoken, mode, lastEvent?.id]);
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);

  const seek = (value: number) => { setElapsed(value); setExtraEvents([]); lastSpoken.current = ''; if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };
  const inject = (role: SourceRole, kind: EvidenceKind) => {
    setRunning(false);
    const option = SOURCE_BRIEFS[role].options.find((item) => item.kind === kind)!;
    setExtraEvents((value) => {
      const ledger = value.reduce(appendCaseEvidence, createReplayCase(elapsed).events);
      const revision = ledger.filter((item) => item.role === role).reduce((max, item) => Math.max(max, item.revision), 0) + 1;
      return [...value, { id: `replay-edit-${role}-${Date.now()}-${revision}`, role, kind, text: option.text, revision, origin: 'scripted', createdAt: new Date().toISOString(), sourceLabel: `Replay intervention · ${SOURCE_BRIEFS[role].name}` }];
    });
    setNotice(kind === 'pharmacy_pending' ? 'New pharmacy evidence reopened the handoff. Approval alone is not pickup confirmation.' : 'Replay source evidence added. The case now reflects the latest source report.');
  };
  const createRoom = async () => { setBusy(true); setError(''); try { setLive(await createLiveSession()); setNotice('Live room created. Open the three private source links for your participants.'); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } };
  const leaveRoom = () => { setLive(null); setConsent(false); setNotice('Saved room access cleared from this tab. Existing participant links still belong to the previous room.'); try { window.sessionStorage.removeItem(LIVE_ROOM_STORAGE); } catch { /* Storage may be disabled by the browser. */ } };
  const call = async (role: SourceRole) => { if (!live || !consent) return; setCallBusy(role); setError(''); try { const output = await dialSource(live.session.id, live.operatorToken, role); setNotice(`The ${roleLabel[role].toLowerCase()} call was accepted (${output.callId}). Waiting for actual source evidence; this is not a completed handoff.`); } catch (err) { setError(errorText(err)); } finally { setCallBusy(null); } };
  const setRoomMode = (value: 'replay' | 'live') => { setMode(value); setRunning(false); setNotice(''); setError(''); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };

  return <div className={`rx-app ${resolved ? 'rx-case-ready' : ''}`}>
    <header className="rx-header"><Brand /><a className="rx-back-link" href="/">All experiences<Icon name="external" size={13} /></a><div className="rx-mode-switch" aria-label="Case mode"><button aria-pressed={mode === 'replay'} onClick={() => setRoomMode('replay')}>Guided replay</button><button aria-pressed={mode === 'live'} onClick={() => setRoomMode('live')}>Live source room<span className="rx-mode-dot" /></button></div></header>
    <main className="rx-main">
      <section className="rx-intro">
        <div><div className="rx-eyebrow"><span className="rx-eyebrow-line" /> A LITTLE LESS HOLD MUSIC. A LOT MORE FOLLOW-THROUGH.</div><h1>One prescription.<br /><span>Three stories.</span></h1><p>The pharmacy is waiting. The clinic says it sent the form.<br className="rx-desktop-break" /> The insurer can’t find it. Let’s connect the dots.</p></div>
        <div className="rx-case-stamp"><span className="rx-case-stamp-icon"><Icon name="link" size={25} /></span><div><span>ADMINISTRATIVE CASE / 001</span><strong>Clear the paperwork.<br />Confirm pickup.</strong><small>{mode === 'replay' ? 'Synthetic, scripted replay · fictional organizations' : 'Live participant evidence · fictional case only'}</small></div></div>
      </section>

      {mode === 'live' && <section className="rx-live-console">
        <div><span className="rx-live-label"><span /> LIVE SOURCE ROOM</span><h2>{live ? 'Three participants. One shared record.' : 'Let real source updates drive the case.'}</h2><p>{live ? 'Open each private link in a separate tab or share it with its roleplay participant. Statements appear only after the server saves them.' : 'Create a room, invite the pharmacy, insurer, and clinic, then collect their actual statements. No scripted updates run in this mode.'}</p></div>
        {!live && <button className="rx-button rx-button-primary" disabled={busy || restoring} onClick={createRoom}>{restoring ? 'Reconnecting room…' : busy ? 'Creating room…' : 'Create live room'}<Icon name="arrow" /></button>}
        {live && <div className="rx-source-links">{SOURCE_ROLES.map((role) => <a key={role} href={new URL(live.sourceLinks[role], window.location.origin).href} target="_blank" rel="noreferrer">{roleLabel[role]} room<Icon name="external" size={14} /></a>)}<button className="rx-leave-room" onClick={leaveRoom}>Leave saved room<Icon name="reset" size={13} /></button></div>}
        <div className="rx-live-readiness"><span className={readiness?.liveRooms ? 'rx-ready-dot' : 'rx-wait-dot'} />{readiness?.liveRooms ? 'Source room server connected' : 'Source room connection unverified'}<span className="rx-readiness-divider">·</span>{readiness?.phone.ready ? 'Phone transport configured' : 'Phone calls not configured'}{readiness && !readiness.phone.ready && <small>Missing: {readiness.phone.missing.join(', ')}</small>}</div>
        {live && <label className="rx-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Call only consenting roleplay participants at the configured test numbers.</label>}
      </section>}

      <div className="rx-workspace">
        <section className="rx-case-stage" aria-label="Connected case sources">
          <div className="rx-stage-heading"><span><span className={`rx-state-dot ${resolved ? 'rx-green' : ''}`} />{mode === 'replay' ? 'THE HANDOFF, IN FULL VIEW' : 'LIVE CASE RECORD'}</span><span>{snapshot.confirmedCount} / 6 receipts confirmed</span></div>
          <div className="rx-network">
            <svg className="rx-connectors" viewBox="0 0 900 300" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="rx-link-gradient"><stop offset="0" stopColor="#e7ba74" /><stop offset="1" stopColor="#82dcc1" /></linearGradient></defs>{[150, 450, 750].map((x, i) => <g key={x}><path className={`rx-network-line ${snapshot.latestByRole[SOURCE_ROLES[i]] ? 'rx-line-on' : ''}`} d={`M${x} 80 V132 Q${x} 155 ${x < 450 ? x + 24 : x > 450 ? x - 24 : x} 155 H450 V225`} /><circle className={running && lastEvent?.role === SOURCE_ROLES[i] ? 'rx-travelling-dot' : 'rx-static-dot'} cx={x} cy="115" r="3" /></g>)}</svg>
            <div className="rx-nodes">{SOURCE_ROLES.map((role) => {
              const report = snapshot.latestByRole[role];
              const current = report && lastEvent?.role === role;
              return <button key={role} className={`rx-source-node rx-role-${role} ${report ? 'rx-has-report' : ''} ${current ? 'rx-current-source' : ''}`} onClick={() => report && viewEvidence(`${roleLabel[role]} source report`, [report.id])} disabled={!report}>
                <span className="rx-node-top"><span className="rx-avatar">{SOURCE_BRIEFS[role].initials}</span><span className="rx-node-index">0{SOURCE_ROLES.indexOf(role) + 1}</span></span><strong>{roleLabel[role]}</strong><span className="rx-node-org">{SOURCE_BRIEFS[role].name}</span><span className={`rx-node-state ${report ? 'rx-reported' : ''}`}><i />{report ? report.kind === 'pharmacy_ready' ? 'Pickup confirmed' : report.kind === 'insurer_approved' ? 'Decision confirmed' : report.kind === 'clinic_resent' ? 'Corrected form sent' : report.kind === 'clinic_accepted' ? 'Owner committed' : report.kind === 'insurer_received' ? 'Receipt confirmed' : report.kind === 'insurer_missing' ? 'Form not located' : report.kind === 'pharmacy_pending' ? 'Pickup unconfirmed' : report.kind === 'clinic_sent' ? 'Reports form sent' : 'Blocker reported' : 'Awaiting source'}</span>
              </button>;
            })}</div>
            <div className={`rx-central-hub ${resolved ? 'rx-hub-ready' : ''}`} key={snapshot.headline}><span className="rx-hub-icon"><Icon name={resolved ? 'check' : 'link'} size={23} /></span><div><span>{resolved ? 'CLOSED WITH SOURCE CONFIRMATION' : 'THE CURRENT BLOCKER'}</span><strong>{snapshot.headline}</strong></div><span className="rx-hub-receipt">{resolved ? '6 / 6' : `${snapshot.confirmedCount} / 6`}</span></div>
          </div>
          <div className="rx-stage-caption" aria-live="polite"><span className="rx-caption-marker">{mode === 'replay' ? time(elapsed) : 'LIVE'}</span><p>{mode === 'replay' && !extraEvents.length ? currentBeat?.caption ?? 'Three accounts. No shared certainty. Press play to follow the handoff.' : snapshot.explanation}</p>{lastEvent && <button onClick={() => viewEvidence('What this update is based on', [lastEvent.id])} aria-label="Inspect latest source evidence"><Icon name="quote" size={17} /></button>}</div>
          {conflict && <button className={`rx-conflict-strip ${conflict.resolved ? 'rx-conflict-resolved' : ''}`} onClick={() => viewEvidence(conflict.title, conflict.evidenceIds)}><span className="rx-conflict-icon">{conflict.resolved ? <Icon name="check" size={15} /> : '≠'}</span><span><strong>{conflict.resolved ? 'The dispatch gap is resolved.' : '“Sent” and “received” are different stories.'}</strong><small>{conflict.resolved ? 'A separate insurer receipt closes the conflict.' : 'Open the two source statements. See exactly where the handoff broke.'}</small></span><Icon name="arrow" size={17} /></button>}
        </section>

        <aside className={`rx-next-panel ${resolved ? 'rx-next-ready' : ''}`}>
          <div className="rx-eyebrow">{resolved ? 'THE PAYOFF' : 'A NEXT STEP. WITH A NAME.'}</div>
          {resolved ? <><div className="rx-success-symbol"><Icon name="check" size={36} /></div><h2>Your prescription.<br /><span>Ready for pickup.</span></h2><p>The pharmacy confirmed processing is complete. Every administrative handoff has a supporting source receipt.</p><button className="rx-button rx-button-outline" onClick={() => viewEvidence('The complete pickup receipt trail', snapshot.activeEvidenceIds)}>See the receipt trail<Icon name="arrow" /></button></> : <><h2>{snapshot.owner ? <>Next up:<br /><span>{roleLabel[snapshot.owner]}.</span></> : <>First, find<br /><span>the blocker.</span></>}</h2><p>{snapshot.nextAction}</p><div className="rx-owner-card"><span className="rx-avatar">{snapshot.owner ? SOURCE_BRIEFS[snapshot.owner].initials : '—'}</span><div><small>CURRENT OWNER</small><strong>{snapshot.owner ? SOURCE_BRIEFS[snapshot.owner].name : 'Not established yet'}</strong></div></div><div className="rx-promise"><span>{promiseLabel}</span>{accepted ? <button onClick={() => viewEvidence('The accepted clinic commitment', [accepted.id])}><strong>{SOURCE_BRIEFS.clinic.name}</strong><small>{accepted.text}</small><span>Read the exact commitment<Icon name="quote" size={14} /></span></button> : <p>No named commitment yet.<br />A suggested next step is not an accepted promise.</p>}</div></>}
          <div className="rx-proof-note"><Icon name="shield" size={15} /><span>{resolved ? 'A new contradictory update will reopen the case.' : 'No green check without a source receipt.'}</span></div>
        </aside>
      </div>

      {mode === 'replay' && <section className="rx-replay-bar" aria-label="Replay controls"><div className="rx-playback"><button className="rx-play" aria-label={running ? 'Pause replay' : 'Play replay'} onClick={() => { if (elapsed >= REPLAY_DURATION) seek(0); if (running && 'speechSynthesis' in window) window.speechSynthesis.cancel(); setRunning(!running); }}><Icon name={running ? 'pause' : 'play'} size={20} /></button><button className="rx-reset" aria-label="Reset replay" onClick={() => { seek(0); setRunning(false); setNotice(''); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }}><Icon name="reset" size={17} /></button><span className="rx-time">{time(elapsed)}<span> / {time(REPLAY_DURATION)}</span></span></div><div className="rx-timeline"><input aria-label="Replay position" type="range" min="0" max={REPLAY_DURATION} step="0.1" value={elapsed} onChange={(event) => seek(Number(event.target.value))} style={{ '--rx-progress': `${elapsed / REPLAY_DURATION * 100}%` } as React.CSSProperties} /><div className="rx-timeline-labels"><span>SCRIPTED REPLAY · SYNTHETIC CASE</span><span>Source by source. Receipt by receipt.</span></div></div><div className="rx-chapter-buttons"><button onClick={() => { seek(20); setRunning(false); }}>Reveal blocker<Icon name="arrow" size={13} /></button><button onClick={() => { seek(73); setRunning(false); }}>Confirm handoff<Icon name="check" size={13} /></button></div><button className={`rx-voice-button ${spoken ? 'rx-voice-on' : ''}`} aria-pressed={spoken} onClick={() => { if (!('speechSynthesis' in window)) { setError('Browser-generated voice is unavailable in this browser. The full source text remains available.'); return; } setSpoken(!spoken); if (spoken) window.speechSynthesis.cancel(); }}><Icon name="sound" size={17} /><span>Browser voice<small>{spoken ? 'On · synthetic narration' : 'Off · optional narration'}</small></span></button></section>}

      <section className="rx-lower-grid"><div className="rx-lanes"><div className="rx-section-title"><div><span className="rx-eyebrow">THREE VOICES. ONE RECORD.</span><h2>What each source actually said.</h2></div><span className="rx-record-count">{events.length} SOURCE {events.length === 1 ? 'RECEIPT' : 'RECEIPTS'}</span></div><div className="rx-lane-grid">{SOURCE_ROLES.map((role) => { const reports = events.filter((event) => event.role === role); const latest = reports.at(-1); return <article className={`rx-transcript-lane rx-role-${role}`} key={role}><header><span className="rx-lane-dot" /><strong>{roleLabel[role]}</strong><span>{reports.length ? `R${latest!.revision}` : 'NO RECEIPT'}</span></header>{latest ? <button className="rx-source-quote" onClick={() => viewEvidence(`${roleLabel[role]} source history`, reports.map((event) => event.id))}><Icon name="quote" size={20} /><blockquote>“{latest.text}”</blockquote><footer>{stamp(latest)}<span>Inspect source<Icon name="arrow" size={12} /></span></footer></button> : <div className="rx-no-report"><span>“</span><p>{mode === 'live' ? 'Waiting for a real participant statement.' : 'This source hasn’t spoken yet.'}</p><small>Unknown stays unknown.</small></div>}{mode === 'live' && live && <button className="rx-call-button" disabled={!readiness?.phone.ready || !consent || callBusy !== null} onClick={() => call(role)}><Icon name="phone" size={14} />{callBusy === role ? 'Requesting actual call…' : 'Call participant'}</button>}</article>; })}</div></div><aside className="rx-milestones"><div className="rx-eyebrow">THE RECEIPT TRAIL</div><h2>Follow-through,<br />not follow-up.</h2><ol>{snapshot.milestones.map((milestone, index) => <li key={milestone.id} className={`rx-milestone-${milestone.status}`}><button disabled={!milestone.evidenceIds.length} onClick={() => viewEvidence(milestone.label, milestone.evidenceIds)}><span className="rx-milestone-icon">{milestone.status === 'complete' ? <Icon name="check" size={12} /> : String(index + 1).padStart(2, '0')}</span><span>{milestone.label}<small>{milestone.status === 'complete' ? 'Source confirmed' : milestone.status === 'active' ? 'Needs a receipt' : 'Not established'}</small></span></button></li>)}</ol></aside></section>

      {mode === 'replay' && <section className="rx-intervention"><div><span className="rx-eyebrow">TRUST NEEDS A REVERSE GEAR.</span><h2>What if the handoff breaks again?</h2><p>A newer pharmacy report must outrank an old green check. Try it.</p></div><button className="rx-button rx-button-outline rx-break-button" disabled={!events.length} onClick={() => inject('pharmacy', 'pharmacy_pending')}>Break the handoff<span>↗</span></button><details className="rx-replay-tools"><summary>Replay source controls <span>Scripted interventions only</span></summary><div>{SOURCE_ROLES.map((role) => <section key={role}><strong>{roleLabel[role]}</strong>{SOURCE_BRIEFS[role].options.slice(0, 3).map((option) => <button key={option.kind} onClick={() => inject(role, option.kind)}>{option.label}<Icon name="arrow" size={12} /></button>)}</section>)}</div></details></section>}
      {notice && <div className="rx-feedback rx-notice" role="status"><Icon name="check" size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification"><Icon name="close" size={15} /></button></div>}{error && <div className="rx-feedback rx-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
      <footer className="rx-footer"><span><Icon name="shield" size={14} />Fictional administrative case. No real patient data.</span><span>{mode === 'replay' ? 'Scripted replay · optional browser-generated narration' : 'Live evidence · persisted after server acknowledgement'}</span><span>Clarity at every handoff.</span></footer>
    </main>
    <dialog className="rx-evidence-dialog" ref={evidenceDialog} onClose={() => setDetail(null)} onClick={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><div className="rx-evidence-top"><span className="rx-eyebrow">THE SOURCE, IN ITS OWN WORDS</span><button onClick={() => setDetail(null)} aria-label="Close evidence"><Icon name="close" size={20} /></button></div><h2>{detail?.title}</h2><p className="rx-evidence-intro">Every case conclusion points back to a statement. A dispatch, a promise, and a receipt are recorded separately.</p>{events.filter((event) => detail?.ids.includes(event.id)).map((event) => <article className={`rx-evidence-item rx-role-${event.role}`} key={event.id}><header><span className="rx-avatar">{SOURCE_BRIEFS[event.role].initials}</span><div><strong>{SOURCE_BRIEFS[event.role].name}</strong><small>{roleLabel[event.role]} · Revision {event.revision} · {stamp(event)}</small></div></header><blockquote>“{event.text}”</blockquote><footer><span>{event.origin === 'scripted' ? 'Scripted synthetic evidence' : event.origin === 'retell' ? 'Telephone source report' : 'Live participant statement'}</span><code>{event.id.slice(0, 22)}</code></footer></article>)}<p className="rx-evidence-disclaimer"><Icon name="shield" size={16} />These are source reports for a fictional case, not medical advice or actual coverage decisions.</p></dialog>
  </div>;
}
