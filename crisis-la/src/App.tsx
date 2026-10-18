import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialPlaybackState, playbackReducer, deriveSnapshot, formatTime } from './engine';
import { CHAPTERS, DURATION, SCENARIO_SOURCE, SPEAKER_LABELS, VERIFICATION_CUES } from './scenario';
import { themeVariables } from './theme';
import { MapScene } from './MapScene';
import { Icon } from './icons';
import { usePreparedAudio } from './audio';
import { CctvPanel } from './CctvPanel';
import { cameraForTime, camerasAt } from './cctv';
import type { ScenarioCamera } from './cctv';
import type { IconName } from './icons';
import type { PlaybackState, ScenarioSnapshot } from './types';

function IconButton({icon,label,onClick,active,disabled=false}:{icon:IconName;label:string;onClick:()=>void;active?:boolean;disabled?:boolean}) {
  return <button className={`icon-button ${active ? 'active' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={active}><Icon name={icon}/></button>;
}

export default function App() {
  const [state, dispatch] = useReducer(playbackReducer, initialPlaybackState);
  const snapshot = useMemo(() => deriveSnapshot(state), [state]);
  const [audioRevision, setAudioRevision] = useState(0);
  const audio = usePreparedAudio(state, snapshot, audioRevision);
  const [exploring, setExploring] = useState(false);
  const [camerasEnabled, setCamerasEnabled] = useState(true);
  const [selectedCameraId, setSelectedCameraId] = useState<ScenarioCamera['id'] | null>(null);
  const [focusedCamera, setFocusedCamera] = useState<ScenarioCamera | null>(null);
  const scenarioCamera = cameraForTime(state.elapsed, selectedCameraId);
  const [about, setAbout] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!state.playing) return;
    let handle:number;
    let previous = performance.now();
    let accumulated = 0;
    const tick = (now:number) => {
      const delta = Math.max(0, (now - previous) / 1000);
      previous = now;
      if (!document.hidden) {
        accumulated += delta;
        if (accumulated >= .03) {
          dispatch({type:'tick',delta:accumulated}); accumulated = 0;
        }
      }
      handle = requestAnimationFrame(tick);
    };
    const visibility = () => { previous = performance.now(); accumulated = 0; };
    document.addEventListener('visibilitychange', visibility);
    handle = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(handle); document.removeEventListener('visibilitychange', visibility); };
  }, [state.playing]);
  useEffect(() => {
    const onKey = (event:KeyboardEvent) => {
      if (event.code !== 'Space' || about || document.querySelector('dialog[open]') || !state.launched || /INPUT|BUTTON|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return;
      event.preventDefault(); dispatch({type:'togglePlay'});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.launched, about]);
  useEffect(() => {
    if (about) dialog.current?.showModal(); else dialog.current?.close();
  }, [about]);

  function clearCameraFocus() { setFocusedCamera(null);setSelectedCameraId(null);setExploring(false); }
  function hideCameras() { setCamerasEnabled(false);clearCameraFocus(); }
  function seek(elapsed:number) { audio.stop();setAudioRevision(value=>value+1);clearCameraFocus(); dispatch({type:'seek',elapsed}); }
  function chooseCamera(id:ScenarioCamera['id']) { setSelectedCameraId(id);setCamerasEnabled(true); }
  function locateCamera(camera:ScenarioCamera) { chooseCamera(camera.id);setFocusedCamera(camera);setExploring(false);dispatch({type:'selectReport',id:camera.reportId}); }
  function chapterStep(direction:number) {
    const index = CHAPTERS.findIndex(chapter => chapter.id === snapshot.chapter.id);
    seek(CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, index + direction))].start);
  }
  function launch() { audio.unlock();audio.stop();setAudioRevision(value=>value+1);clearCameraFocus(); dispatch({type:'launch'}); }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { /* The browser may disallow fullscreen; the full-window layout remains available. */ }
  }
  const phaseLabel = !state.launched ? 'Ready to replay' : snapshot.awaitingApproval ? 'Awaiting review' : snapshot.complete ? 'Replay complete' : state.playing ? 'Playing scenario' : 'Paused';
  const approval = !!snapshot.approvedFacts;

  return <div className={`app-shell ${state.launched ? 'has-launched' : 'is-ready'}`} style={themeVariables}>
    <audio ref={audio.element} preload="auto" aria-hidden="true" hidden/>
    <header className="topbar">
      <a className="wordmark" href="#" onClick={event => {event.preventDefault();dispatch({type:'reset'});clearCameraFocus();}} aria-label="SourceCheck, reset replay"><span className="brand-symbol"><i/><i/><i/></span>SourceCheck<span className="product-subtitle"> / Crisis Replay</span></a>
      <a href="/prescription" style={{textDecoration:'none',fontSize:12,color:'var(--cyan)',border:'1px solid var(--border)',borderRadius:5,padding:'8px 11px',whiteSpace:'nowrap'}}>Prescription case room ↗</a>
      <span className="topbar-location">LOS ANGELES, CA <span>/</span> EXERCISE</span>
      <div className="topbar-right"><span className="simulation-tag"><span/>Rachel · fictional scenario</span><button className="about-button" onClick={() => setAbout(true)} aria-label="About this scenario and sources"><Icon name="info" size={17}/></button></div>
    </header>

    <main className="experience">
      <section className="geographic-stage" aria-label="Scenario map">
        <MapScene state={state} snapshot={snapshot} reducedMotion={reducedMotion} exploring={exploring} onExplore={() => {if(state.launched) setExploring(true);}} onSelect={id => dispatch({type:'selectReport',id})} camerasEnabled={camerasEnabled} activeCameraId={scenarioCamera?.id ?? null} focusedCamera={focusedCamera} onCameraSelect={chooseCamera}/>
        {!state.launched ? <div className="intro">
          <div className="eyebrow"><span className="line"/> A CRISIS REPLAY IN SIX CHAPTERS</div>
          <h1>Los Angeles.<br/><span>After the storm.</span></h1>
          <p>Hurricane Rachel has damaged the city.<br/>Get callers the right address for food and water.</p>
          <button className="launch-button" onClick={launch}><Icon name="play" size={18}/>Launch Crisis Demo<Icon name="arrow" size={18}/></button>
          <div className="intro-meta"><span>02:55 + your review</span><span>Scripted playback</span><span>Synthetic call audio + captions</span></div>
        </div> : <div className="chapter-overlay" key={snapshot.chapter.id}>
          <div className="eyebrow"><span className="chapter-number">{snapshot.chapter.number} / 06</span>{snapshot.chapter.label.toUpperCase()}</div>
          <h1>{snapshot.complete ? 'A clearer answer.' : snapshot.chapter.id === 'arrival' ? <>Los Angeles.<br/>After the storm.</> : snapshot.chapter.id === 'reports' ? <>A city of<br/>questions.</> : snapshot.chapter.id === 'question' ? <>One question.<br/>Two locations.</> : snapshot.chapter.id === 'verification' ? <>Go to<br/>the source.</> : snapshot.chapter.id === 'review' ? approval ? <>The picture<br/>changes.</> : <>One update.<br/>Your review.</> : <>The right place.<br/>A clearer answer.</>}</h1>
          <p>{snapshot.complete ? 'The approved location now informs the next response.' : snapshot.chapter.id === 'reports' ? 'Incoming reports are leads, not verified conditions.' : snapshot.chapter.id === 'question' ? 'Where is food and water distribution now?' : snapshot.chapter.id === 'verification' ? 'A prepared conversation resolves the location.' : snapshot.chapter.id === 'review' ? approval ? 'One reviewed record. A shared view of where to go.' : 'Check the evidence before updating the listing.' : snapshot.chapter.id === 'answer' ? 'The map and response use the same reviewed update.' : 'Hurricane Rachel · Fictional aftermath'}</p>
        </div>}
        <div className="map-tools">
          {state.launched && <><button className={`map-tool cctv-toggle`} onClick={() => {if(camerasEnabled) hideCameras(); else setCamerasEnabled(true);}} aria-pressed={camerasEnabled} aria-label={camerasEnabled ? 'Hide camera layer' : 'Show camera layer'} title="Simulated camera evidence"><Icon name="camera" size={16}/><span>Cameras · {camerasAt(state.elapsed).length}</span></button><button className={`map-tool ${exploring || focusedCamera ? 'exploring' : ''}`} onClick={clearCameraFocus} title="Resume directed camera"><Icon name="crosshair" size={16}/><span>{exploring || focusedCamera ? 'Resume camera' : 'Directed camera'}</span></button></>}
          <IconButton icon="expand" label="Toggle fullscreen" onClick={fullscreen}/>
        </div>
        {state.launched && camerasEnabled && scenarioCamera && <CctvPanel camera={scenarioCamera} state={state} approved={approval} onSelect={chooseCamera} onLocate={locateCamera} onHide={hideCameras} onPause={() => dispatch({type:'togglePlay'})} onResume={() => dispatch({type:'togglePlay'})}/>}
        {approval && state.elapsed > 113 && state.elapsed < 140 && <div className="relocation-note"><Icon name="arrow" size={16}/><span>Distribution relocated<small>Relationship · not a travel route</small></span></div>}
        {state.launched && <div className="map-footer">
          <div className="map-legend"><span><i className="legend-dot amber"/>Needs verification</span><span><i className="legend-dot red"/>Reported disruption</span>{approval && <span><i className="legend-dot green"/>Reviewed</span>}</div>
          <span className="coordinate-note">34.0522° N &nbsp; 118.2437° W</span>
        </div>}
        {state.captions && snapshot.activeCue && <div className={`caption ${snapshot.activeCue.speaker === 'Coordinator' ? 'coordinator' : ''}`} key={snapshot.activeCue.id}>
          <span>{SPEAKER_LABELS[snapshot.activeCue.speaker]}<small>Synthetic voice · scripted reenactment</small></span><p>{snapshot.activeCue.text}</p>
        </div>}
      </section>

      <aside className="story-panel" aria-label="Scenario evidence and activity">
        <div className="panel-status"><span><i className={`status-light ${state.playing ? 'playing' : ''}`}/>{phaseLabel}</span><span className="elapsed">{formatTime(state.elapsed)}</span></div>
        {!state.launched ? <div className="briefing">
          <div className="section-kicker">FOR DISASTER INFORMATION HOTLINES</div><h2>You keep the<br/>answers current.</h2>
          <p>Rachel has left flooding and power failures across LA. You supervise the hotline, where callers need water and pickup reports conflict.</p>
          <div className="briefing-line"/>
          <div className="briefing-step"><span>01</span><div><h3>A resident calls for help</h3><p>The old listing points to the school. New reports suggest pickup has moved.</p></div></div>
          <div className="briefing-step"><span>02</span><div><h3>Check the distribution site</h3><p>Ask its coordinator which location is operating. Review the answer and its source.</p></div></div>
          <div className="briefing-step"><span>03</span><div><h3>Update the shared hotline answer</h3><p>The next operator can give the new address instead of repeating the old listing.</p></div></div>
          <div className="history-note"><Icon name="info" size={16}/><p>Fictional stronger-storm exercise. Real LA geography; simulated damage, calls, and aid locations.</p></div>
        </div> : <StoryPanel state={state} snapshot={snapshot} onSelect={id=>dispatch({type:'selectReport',id})} onApprove={()=>dispatch({type:'approve'})} onReplay={launch}/>}
        <div className="panel-bottom"><span><Icon name="volume" size={15}/>{audio.status==='unavailable'?'Audio unavailable · captions active':audio.status==='blocked'?'Click sound to enable audio':audio.enabled?'Synthetic voices · local playback':'Sound off · captions available'}</span><button onClick={()=>setAbout(true)}>Sources<Icon name="chevron" size={12}/></button></div>
      </aside>
    </main>

    <footer className="transport">
      <div className="chapters" aria-label="Replay chapters">{CHAPTERS.map(chapter => <button key={chapter.id} disabled={!state.launched} onClick={()=>seek(chapter.start)} className={snapshot.chapter.id === chapter.id && state.launched ? 'current' : ''}><span>{chapter.number}</span>{chapter.label}{chapter.id==='review' && !approval && <span className="chapter-gate">◇</span>}</button>)}</div>
      <div className="transport-controls">
        <div className="playback-buttons"><IconButton icon="previous" label="Previous chapter" onClick={()=>chapterStep(-1)} disabled={!state.launched}/><button className="play-button" aria-label={snapshot.complete ? 'Replay scenario' : !state.launched ? 'Launch Crisis Demo' : state.playing ? 'Pause playback' : 'Play playback'} onClick={snapshot.complete || !state.launched ? launch : ()=>dispatch({type:'togglePlay'})} disabled={snapshot.awaitingApproval}><Icon name={snapshot.complete ? 'replay' : state.playing ? 'pause' : 'play'} size={18}/></button><IconButton icon="next" label="Next chapter" onClick={()=>chapterStep(1)} disabled={!state.launched}/></div>
        <span className="timecode">{formatTime(state.elapsed)} <span>/ {formatTime(DURATION)}</span></span>
        <div className="scrubber"><input type="range" min="0" max={DURATION} step="0.1" value={state.elapsed} onChange={event=>seek(Number(event.target.value))} disabled={!state.launched} aria-label="Playback position" aria-valuetext={`${formatTime(state.elapsed)} of ${formatTime(DURATION)}`} style={{'--progress':`${state.elapsed / DURATION * 100}%`} as React.CSSProperties}/><span className="review-tick" title="Manual review at 01:50"/></div>
        <button className="speed-button" onClick={()=>dispatch({type:'setSpeed',speed:state.speed===1?2:1})} aria-label={`Playback speed ${state.speed}x. Click to change.`}>{state.speed}×</button>
        <IconButton icon="replay" label="Reset replay" disabled={!state.launched} onClick={()=>{dispatch({type:'reset'});clearCameraFocus();}}/>
        <IconButton icon="captions" label={state.captions?'Hide captions':'Show captions'} active={state.captions} onClick={()=>dispatch({type:'toggleCaptions'})}/>
        <button className={`audio-button ${audio.enabled?'active':''}`} onClick={audio.toggle} aria-pressed={audio.enabled} aria-label={audio.status==='blocked'?'Enable synthetic call audio':audio.enabled?'Mute synthetic call audio':'Unmute synthetic call audio'} title="Local synthetic voices; synchronized to playback"><Icon name={audio.enabled?'volume':'mute'} size={17}/><span>{audio.status==='blocked'?'Enable sound':audio.enabled?'Sound on':'Sound off'}</span></button>
        <label className="presenter-option" title="Automatically performs a labeled scripted approval during playback"><input type="checkbox" checked={state.presenterMode} onChange={event=>dispatch({type:'setPresenter',enabled:event.target.checked})}/><span className="toggle"/><span>Presenter autoplay</span></label>
      </div>
    </footer>

    <dialog ref={dialog} className="about-dialog" onCancel={()=>setAbout(false)} onClick={event=>{if(event.target===event.currentTarget)setAbout(false);}}>
      <div className="dialog-top"><span className="section-kicker">ABOUT THIS SCENARIO</span><IconButton icon="close" label="Close scenario sources" onClick={()=>setAbout(false)}/></div>
      <h2>A fictional hurricane.<br/>A real city.</h2>
      <p>What if a much stronger Hurricane Rachel struck Los Angeles? This authored exercise imagines coastal flooding, wind damage, power failures, and disrupted aid distribution. A fictional pickup operation moves from John Marshall High School to the Dodger Stadium parking lot after flooding.</p>
      <a className="source-link" href={SCENARIO_SOURCE} target="_blank" rel="noreferrer">Read the scenario and geography notes<Icon name="arrow" size={16}/></a>
      <dl><dt>Scenario premise</dt><dd>An imagined stronger Hurricane Rachel affecting LA. This is not a historical event reconstruction, weather forecast, or record of actual relief operations.</dd><dt>Prepared for this replay</dt><dd>All dialogue, callers, report counts, origins, incident states and elapsed times. No actual calls or live inference are represented.</dd><dt>Geography</dt><dd>Present-day Esri imagery and optional Re:Earth / Mapterhorn terrain provide real LA geography. Facility addresses were checked against official pages and Esri. The pickup operation, relocation, damage and report markers are fictional.</dd><dt>Media & review</dt><dd>Local synthetic speech illustrates the caller, hotline assistant and site coordinator. Camera panels show generated still-image recreations, not actual CCTV or exact views of the named facilities. Capture times and observations are authored scenario data. The destination and answer update only after approval. Presenter autoplay performs explicitly scripted approval. Rewinding before review clears that approval.</dd></dl>
      <p className="dialog-footnote">The arc connects former and current locations; it does not show a safe travel route. Unknown closing time stays unknown.</p>
    </dialog>
  </div>;
}

function StoryPanel({state,snapshot,onSelect,onApprove,onReplay}:{state:PlaybackState;snapshot:ScenarioSnapshot;onSelect:(id:string|null)=>void;onApprove:()=>void;onReplay:()=>void}) {
  const selected = snapshot.reports.find(report=>report.id===state.selectedReportId);
  const chapter = snapshot.chapter.id;
  const approved = snapshot.approvedFacts;
  const fields = new Set(snapshot.transcript.filter(cue=>cue.start<=state.elapsed).flatMap(cue=>cue.evidenceFields??[]));
  const groups = Array.from(new Set(snapshot.waterReports.map(report=>report.originId))).map(origin=>({origin,reports:snapshot.waterReports.filter(report=>report.originId===origin)}));
  return <div className="story-content">
    <div className="mission-strip"><span className="field-label">YOUR ROLE · HOTLINE SUPERVISOR</span><strong>{approved?'Share the reviewed pickup answer':state.elapsed<40?'Find out where to send callers':state.elapsed<65?'Resolve one pickup-location question':state.elapsed<110?'Check with the distribution coordinator':'Review the shared hotline update'}</strong></div>
    {selected && <div className={`selected-report tone-${selected.tone}`}><div className="selected-top"><span>SELECTED REPORT · {formatTime(selected.at)}</span><IconButton icon="close" label="Close selected report" onClick={()=>onSelect(null)}/></div><h3>{selected.title}</h3><p>{selected.detail}</p><small>{selected.source}</small></div>}
    {(chapter==='arrival'||chapter==='reports') && <>
      <div className="panel-heading"><span className="section-kicker">REPORTS REACHING THE HOTLINE</span><h2>People need<br/>a reliable answer.</h2><p>Focus on the food-and-water pickup question.</p></div>
      <div className="signal-counts"><div><strong>{String(snapshot.reports.length).padStart(2,'0')}</strong><span>reports</span></div><div><strong>{String(snapshot.distinctOrigins).padStart(2,'0')}</strong><span>declared origins</span></div><span className="fixture-label">SCENARIO<br/>DATA</span></div>
      <div className="feed" aria-label="Incoming prepared reports">{snapshot.reports.length===0?<div className="feed-wait"><span className="waiting-orbit"/><p>Looking across Los Angeles</p><small>Prepared reports begin at 00:14</small></div>:[...snapshot.reports].reverse().map(report=><button className={`feed-item tone-${report.tone}`} key={report.id} onClick={()=>onSelect(report.id)}><span className="feed-icon"><Icon name={report.category} size={16}/></span><span><strong>{report.title}</strong><small>{report.area} · Reported</small></span><time>{formatTime(report.at)}</time></button>)}</div>
      <p className="panel-note">Water pickup is the active task. Other reports provide context.</p>
    </>}
    {chapter==='question' && <>
      <div className="panel-heading"><span className="section-kicker">VERIFICATION TASK · FOOD + WATER</span><h2>Where should we<br/>send callers?</h2></div>
      <div className="question-listing"><span className="field-label">PRIOR LISTING</span><h3>John Marshall High</h3><p>3939 Tracy Street</p><span className="status-pill amber">Needs verification</span></div>
      <div className="origin-heading"><strong>{snapshot.waterReports.length} messages <span>→</span> {snapshot.waterOrigins} origins</strong><span>DECLARED IN SCENARIO</span></div>
      <div className="origin-groups">{groups.map(group=><div className="origin-group" key={group.origin}><span className="origin-dots">{group.reports.map(report=><i key={report.id}/>)}</span><div><strong>{group.origin==='school-bulletin-a'?'“Water is at the school.”':group.origin==='relocation-note-b'?'“Someone says pickup moved.”':'“I collected supplies at Dodger Stadium.”'}</strong><small>{group.reports.length} message{group.reports.length===1?'':'s'} · {group.origin==='destination-note-c'?'firsthand-style note':'one shared origin'}</small></div></div>)}</div>
      <div className="next-action"><Icon name="arrow" size={18}/><p>Check this once with the coordinator, then let operators reuse the reviewed answer.</p></div>
    </>}
    {chapter==='verification' && <>
      <div className="panel-heading"><span className="section-kicker">VERIFICATION PLAYBACK</span><h2>Check with<br/>the coordinator.</h2><p>Hotline assistant → distribution coordinator</p></div>
      <div className="conversation-meta"><span className="avatar">C</span><div><strong>Distribution coordinator</strong><small>Synthetic voice · source conversation</small></div><span className="status-pill cyan">Replay</span></div>
      <div className="transcript-preview" aria-label="Prepared verification transcript">{snapshot.transcript.filter(cue=>cue.start>=65&&cue.start<110).slice(-2).map(cue=><div className={`transcript-turn ${snapshot.activeCue?.id===cue.id?'active':''}`} key={cue.id}><span>{SPEAKER_LABELS[cue.speaker]}<time>{formatTime(cue.start)}</time></span><p>“{cue.text}”</p></div>)}</div>
      <div className="proposed-facts"><span className="field-label">PREPARED FACT PROPOSALS</span><div className={fields.has('address')?'revealed':'pending'}><span>Pickup location</span><strong>{fields.has('address')?'1000 Vin Scully Avenue':'Awaiting statement'}</strong></div><div className={fields.has('previousLocation')?'revealed':'pending'}><span>School location</span><strong>{fields.has('previousLocation')?'No longer the pickup site':'Awaiting statement'}</strong></div><div className={fields.has('supplies')?'revealed':'pending'}><span>Supplies</span><strong>{fields.has('supplies')?'Food + drinking water':'Awaiting statement'}</strong></div><div className="unknown"><span>Closing time</span><strong>{fields.has('closingTime')?'Not confirmed':'Unknown'}</strong></div></div>
      <p className="panel-note">Statements become proposals. Review comes next.</p>
    </>}
    {chapter==='review' && <>
      <div className="panel-heading"><span className="section-kicker">{approved?'REVIEWED UPDATE':'SUPERVISOR REVIEW'}</span><h2>{approved?<>The location<br/>is updated.</>:<>Ready for<br/>your review.</>}</h2><p>{approved?'Operators can reuse this reviewed pickup address.':'Approve the correction to the shared hotline listing.'}</p></div>
      <div className="location-change"><div className="former-location"><span className="field-label">FROM</span><strong>John Marshall High</strong><small>3939 Tracy Street</small></div><span className="change-arrow"><Icon name="arrow" size={18}/></span><div className={`new-location ${approved?'approved':''}`}><span className="field-label">{approved?'REVIEWED PICKUP LOCATION':'PROPOSED PICKUP LOCATION'}</span><h3>1000 Vin Scully Avenue</h3><p>Dodger Stadium parking lot</p><span>Food + drinking water</span></div></div>
      <blockquote className="source-quote"><span className="field-label">COORDINATOR · SCENARIO {formatTime(VERIFICATION_CUES[1].start)}</span><p>“{VERIFICATION_CUES[1].text}”</p><footer>“{VERIFICATION_CUES[2].text}”</footer></blockquote>
      <div className="unknown-hours"><Icon name="hours" size={16}/><span>Today's closing time<strong>Unconfirmed</strong></span></div>
      {approved?<div className="approval-receipt"><Icon name="check" size={18}/><span>{approved.mode==='scripted'?'Scripted approval':'Hotline answer updated'}<small>Supervisor review · Scenario 01:50 · Revision 1</small></span></div>:<><button className="approve-button" onClick={onApprove}><Icon name="check" size={18}/>Approve update<Icon name="arrow" size={18}/></button><p className="approval-hint">Review the address before operators use it for callers.</p></>}
    </>}
    {chapter==='answer' && approved && <>
      <div className="panel-heading"><span className="section-kicker">{snapshot.complete?'REPLAY COMPLETE':'THE NEXT CALLER'}</span><h2>{snapshot.complete?<>One source.<br/>A clearer answer.</>:<>Help reaches<br/>the next caller.</>}</h2></div>
      <div className="caller-question"><span className="field-label">CALLER · SCRIPTED</span><p>“{snapshot.transcript.find(cue=>cue.id==='next-caller-question')?.text}”</p></div>
      <div className="approved-answer"><span className="status-pill green"><Icon name="check" size={13}/>SHARED HOTLINE ANSWER</span><p>{snapshot.answer?.split(approved.address).map((part,index)=><span key={index}>{index>0&&<mark>{approved.address}</mark>}{part}</span>)}</p></div>
      <div className="answer-record"><Icon name="layers" size={16}/><div><strong>What changes for the people using it</strong><p><b>Operator:</b> reuse the checked answer.<br/><b>Resident:</b> hear where pickup moved.<br/><b>Still unknown:</b> today’s closing time.</p><small>Revision 1 · {approved.mode==='scripted'?'Scripted approval':'Supervisor approved'}</small></div></div>
      {snapshot.complete&&<button className="replay-finish" onClick={onReplay}><Icon name="replay" size={16}/>Replay the scenario<Icon name="arrow" size={16}/></button>}
    </>}
  </div>;
}
