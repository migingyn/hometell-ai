import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { cameraClock, frameAge, SCENARIO_CAMERAS } from './cctv';
import type { ScenarioCamera } from './cctv';
import type { PlaybackState } from './types';
import './cctv.css';

type Props = {
  camera: ScenarioCamera;
  state: PlaybackState;
  approved: boolean;
  onSelect: (id: ScenarioCamera['id']) => void;
  onLocate: (camera: ScenarioCamera) => void;
  onHide: () => void;
  onPause: () => void;
  onResume: () => void;
};

function CameraFrame({ camera, elapsed }: { camera: ScenarioCamera; elapsed: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [camera.id]);
  return <div className="cctv-frame">
    {failed ? <div className="cctv-missing"><Icon name="camera" size={28}/><span>Frame unavailable</span><small>The report and source conversation remain available.</small></div>
      : <img src={camera.image} alt={`Simulated camera illustration: ${camera.observation}`} onError={() => setFailed(true)}/>}
    <div className="cctv-scanlines" aria-hidden="true"/>
    <div className="cctv-frame-top"><span className="cctv-sim-label"><i/>SIMULATED FRAME</span><span>{camera.code}</span></div>
    <div className="cctv-frame-bottom"><span>{camera.direction}</span><time>SCENARIO {cameraClock(camera.availableAt)}</time></div>
    <span className="cctv-corner cctv-corner-tl" aria-hidden="true"/><span className="cctv-corner cctv-corner-br" aria-hidden="true"/>
    <span className="cctv-age">Captured {frameAge(camera, elapsed)}</span>
  </div>;
}

export function CctvPanel({ camera, state, approved, onSelect, onLocate, onHide, onPause, onResume }: Props) {
  const [view, setView] = useState<'single' | 'compare' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const resumeAfterClose = useRef(false);
  const available = SCENARIO_CAMERAS.filter(item => item.availableAt <= state.elapsed);
  const close = () => {
    setView(null);
    if (resumeAfterClose.current) onResume();
    resumeAfterClose.current = false;
  };
  const open = (mode: 'single' | 'compare') => {
    resumeAfterClose.current = state.playing;
    if (state.playing) onPause();
    setView(mode);
  };
  useEffect(() => {
    if (view) dialog.current?.showModal(); else dialog.current?.close();
  }, [view]);

  return <>
    <section className="cctv-dock" aria-label="Camera evidence">
      <header className="cctv-header"><span><Icon name="camera" size={15}/>CAMERA EVIDENCE</span><div>
        <button aria-label="Expand camera view" title="Expand camera view" onClick={() => open('single')}><Icon name="expand" size={14}/></button>
        <button aria-label="Hide camera evidence" title="Hide camera evidence" onClick={onHide}><Icon name="close" size={15}/></button>
      </div></header>
      <button className="cctv-preview" aria-label={`Expand ${camera.name} camera`} onClick={() => open('single')}><CameraFrame camera={camera} elapsed={state.elapsed}/></button>
      <div className="cctv-tabs" aria-label="Choose a scenario camera">{SCENARIO_CAMERAS.map((item,index) => <button key={item.id} className={item.id === camera.id ? 'active' : ''} disabled={state.elapsed < item.availableAt} aria-pressed={item.id === camera.id} onClick={() => onSelect(item.id)} title={state.elapsed < item.availableAt ? 'Frame arrives at scenario 01:15' : item.location}><span>0{index+1}</span>{item.name}{state.elapsed < item.availableAt && <Icon name="hours" size={11}/>}</button>)}</div>
      <div className="cctv-context"><span className="cctv-context-label">{camera.location}</span><p>{camera.observation}</p>
        <div className={`cctv-context-status ${approved ? 'reviewed' : ''}`}><Icon name={approved ? 'check' : 'info'} size={13}/><span>{approved ? 'Pickup details confirmed by the reviewed call.' : 'Visual clue · pickup details still need a source.'}</span></div>
      </div>
      <footer className="cctv-actions"><button onClick={() => onLocate(camera)}><Icon name="crosshair" size={14}/>Locate on map</button><button disabled={available.length < 2} onClick={() => open('compare')}><Icon name="layers" size={14}/>Compare sites</button></footer>
      <button className="cctv-compact-open" onClick={() => open('single')}><span>{camera.name}<small>Simulated frame · {frameAge(camera, state.elapsed)}</small></span><Icon name="expand" size={14}/></button>
    </section>

    <dialog className="cctv-dialog" aria-labelledby="camera-dialog-title" ref={dialog} onCancel={event => {event.preventDefault();close();}} onClick={event => {if(event.target === event.currentTarget) close();}}>
      <header className="cctv-dialog-header"><div><span className="section-kicker">VISUAL CONTEXT / FICTIONAL RACHEL EXERCISE</span><h2 id="camera-dialog-title">{view === 'compare' ? 'Two views. One question.' : camera.name}</h2><p>{view === 'compare' ? 'A blocked entrance and staged supplies help focus the verification call.' : camera.location}</p></div><div className="cctv-dialog-tools"><button className="cctv-mode-button" disabled={available.length < 2} onClick={() => setView(view === 'compare' ? 'single' : 'compare')}><Icon name="layers" size={14}/>{view === 'compare' ? 'Single view' : 'Compare sites'}</button><button className="icon-button" aria-label="Close camera view" onClick={close}><Icon name="close"/></button></div></header>
      <div className={`cctv-inspector-grid ${view === 'compare' ? 'comparing' : ''}`}>{(view === 'compare' ? available : [camera]).map(item => <article key={item.id}>
        <CameraFrame camera={item} elapsed={state.elapsed}/>
        <div className="cctv-inspector-caption"><span>{item.code} / {item.location}</span><h3>{item.observation}</h3><p>{approved ? 'The source call supplies the reviewed pickup details.' : item.question}</p><button onClick={() => {onSelect(item.id);onLocate(item);close();}}><Icon name="crosshair" size={14}/>Locate this view on the map<Icon name="arrow" size={14}/></button></div>
      </article>)}</div>
      <footer className="cctv-dialog-footer"><p><Icon name="info" size={15}/><span>Generated scene recreations, not recordings of these facilities. A frame does not confirm opening hours or supply availability.</span></p><button className="cctv-dialog-action" onClick={close}>{resumeAfterClose.current ? 'Return to playback' : 'Return to the map'}<Icon name="arrow" size={15}/></button></footer>
    </dialog>
  </>;
}
