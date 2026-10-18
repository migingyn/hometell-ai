'use client';
import Link from 'next/link';
import {useEffect,useId,useRef,useState} from 'react';
import {Activity,ClipboardList,FileText,Phone,UserRound,X} from 'lucide-react';
import {useCare} from './care-context';
import {request} from './api';
import {AlertCard,Badge,time} from './ui';
import {ReadingsList,VitalsHistory,VitalsTrend} from './vitals-workflow';
import CallEvidence from './CallEvidence';
import PreparedContext from './PreparedContext';
import TaskComposer from './TaskComposer';
import {TaskList} from './tasks';

export function ResidentDetail({id,onClose,standalone=false}){
 const care=useCare();const [data,setData]=useState(null);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);const [tab,setTab]=useState(standalone?'summary':care.profileTab);
 const dialog=useRef(null);const closeButton=useRef(null);const key=useId();
 const stamp=care.checks.find(c=>c.client_id===id)?.updated_at;
 useEffect(()=>{let active=true;request(`/api/clients/${encodeURIComponent(id)}`).then(data=>{if(active){setData(data);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,attempt,stamp]);
 useEffect(()=>{if(!standalone)dialog.current?.showModal();closeButton.current?.focus();},[standalone]);
 const close=onClose||(()=>care.setSelected(null));
 const reloadRecord=async()=>{setData(await request(`/api/clients/${id}`));await care.refresh();};
 const c=data?.client;
 const tabs=[['summary','Resident',UserRound],['measurements','Measurements',Activity],['calls','Calls & evidence',Phone],['tasks','Follow-ups',ClipboardList],['notes','Care notes',FileText]];
 const content=<>
  <div className="drawer-header"><span className="eyebrow">ONE RESIDENT. ONE CONNECTED RECORD.</span><button ref={closeButton} aria-label="Close resident record" onClick={close}><X size={18}/></button></div>
  {!c?<><h2>{error?'Unable to load resident':'Loading resident…'}</h2>{error&&<p className="error-message" role="alert">{error}<button onClick={()=>setAttempt(a=>a+1)}>Retry</button></p>}</>:<>
   <div className="profile-title"><span className="room">{c.room}</span><div><span className="eyebrow">{care.activeFacility?.name}</span><h2>{c.name}</h2><p className="muted">Nurse {c.nurse_name||'unassigned'} · Aide {c.aide_name||'unassigned'}</p></div><Badge status={c.card_status}/></div>
   <div className="resident-record-tabs" role="tablist" aria-label="Resident information">{tabs.map(([value,label,Icon])=><button key={value} id={`${key}-${value}`} role="tab" aria-selected={tab===value} aria-controls={`${key}-panel`} onClick={()=>setTab(value)}><Icon size={13}/>{label}</button>)}</div>
   <div role="tabpanel" id={`${key}-panel`} aria-labelledby={`${key}-${tab}`}>
    {tab==='summary'&&<div className="care-stack"><section className="panel"><span className="eyebrow">LATEST REPORTED SITUATION</span><h2>{c.card_reason}</h2><div className="facts"><div><dt>Room</dt><dd>{c.room}</dd></div><div><dt>Assigned nurse</dt><dd>{c.nurse_name}</dd></div><div><dt>Assigned aide</dt><dd>{c.aide_name}</dd></div><div><dt>Language</dt><dd>{c.language==='ko'?'Korean':'English'}</dd></div><div><dt>Transport need</dt><dd>{c.needs_ride?'Ride assistance flagged':'Not recorded'}</dd></div><div><dt>Powered equipment</dt><dd>{c.uses_powered_equipment?'Recorded':'Not recorded'}</dd></div></div><h3>Allergies</h3><p>{c.allergies?.length?c.allergies.join(', '):'Not documented'}</p><h3>Approved medication reminders</h3><p className="preserve">{c.med_schedule_now||'No staff-approved reminder recorded.'}</p></section><section className="panel"><div className="section-heading"><h2>Latest measured vitals</h2>{care.account.role==='nurse'&&<Link href={`/record-vitals?resident=${id}`} className="primary-link" onClick={()=>{if(!standalone)dialog.current?.close();}}>Record vitals</Link>}</div><ReadingsList latest={data.vitals.latest}/></section><section className="panel"><h2>Open concerns</h2>{data.open_alerts.length?data.open_alerts.map(a=><AlertCard key={a.id} alert={a}/>):<p className="empty">No open concerns recorded.</p>}</section></div>}
    {tab==='measurements'&&<div className="care-stack"><div className="section-heading"><div><h2>Measurements & correction history</h2><p className="muted">Explicit units, source, measurement time and entry time.</p></div>{care.account.role==='nurse'&&<Link href={`/record-vitals?resident=${id}`} className="primary-link">Record or correct readings</Link>}</div><VitalsTrend records={data.vitals.records}/><VitalsHistory records={data.vitals.records}/></div>}
    {tab==='calls'&&<div className="care-stack"><CallEvidence check={data.latest_check} client={c} onSaved={reloadRecord}/><PreparedContext context={data.next_call_context}/>{data.last_calls.map(call=><section className="panel" key={call.id}><div className="section-heading"><h2>Call {time(call.created_at)}</h2><Badge>{call.status.replaceAll('_',' ')}</Badge></div><p>{call.summary}</p>{call.context&&<details className="call-context"><summary>View historical prepared context</summary><PreparedContext context={call.context} snapshot/></details>}</section>)}</div>}
    {tab==='tasks'&&<div className="care-stack"><TaskComposer residentId={id}/><TaskList tasks={care.tasks.filter(t=>t.resident_id===id)} title="This resident’s follow-ups"/></div>}
    {tab==='notes'&&<div className="care-stack">{care.account.role==='nurse'?<ClinicalDocumentation id={id} data={data} onSaved={reloadRecord}/>:<section className="panel"><h2>Staff-documented care notes</h2>{data.entries.length?data.entries.map(e=><article className="feed-row" key={e.id}><div><strong>{e.kind}</strong><p>{e.payload.text}</p><small>{e.author_name} · {time(e.created_at)}</small></div></article>):<p className="empty">No notes recorded.</p>}</section>}<section className="panel"><h2>Acknowledgement history</h2>{data.alert_history.length?data.alert_history.map(a=><p key={a.id}>{a.reason}<br/><small>{a.acknowledged_by} · {time(a.acknowledged_at)}</small></p>):<p className="empty">No acknowledgements recorded.</p>}</section></div>}
   </div>
  </>}
 </>;
 return standalone?<section className="resident-record-page">{content}</section>:<dialog ref={dialog} className="drawer" aria-label={c?`${c.name} resident record`:'Resident record'} onCancel={event=>{event.preventDefault();close();}}>{content}</dialog>;
}

function ClinicalDocumentation({id,data,onSaved}) {
  const {account}=useCare();
  const [message,setMessage]=useState('');
  const [pending,setPending]=useState(false);
  return <><section className="panel"><h3>Care notes and approved reminders</h3><form onSubmit={async e=>{
    e.preventDefault();const form=new FormData(e.currentTarget);const kind=form.get('kind');
    const body={text:form.get('text')};
    if(form.get('supersedes')) {body.supersedes=form.get('supersedes');body.correction_reason=form.get('correction_reason');}
    setPending(true);
    try {await request(`/api/clients/${id}/${kind}`,body);await onSaved();setMessage('Signed documentation saved.');}
    catch(err){setMessage(err.message);}finally{setPending(false);}
  }}><label>Documentation type<select name="kind"><option value="notes">Care note / observation</option>{account.can_edit_reminders && <option value="reminders">Approved resident reminder</option>}</select></label><label>Note or approved reminder<textarea name="text" required maxLength={8000} rows={3}/></label><label>Correct an existing record (optional)<select name="supersedes"><option value="">New signed entry</option>{data.entries?.filter(e=>e.kind!=='measurements'&&!data.entries.some(c=>c.supersedes===e.id)).map(e=><option key={e.id} value={e.id}>{e.kind} · {time(e.created_at)} · {e.author_name}</option>)}</select></label><label>Reason for correction (required when correcting)<input name="correction_reason" maxLength={1000}/></label><p className="muted">Demo author: {account.name}. Corrections preserve the original record.</p><p role="status">{message}</p><button className="dark" disabled={pending}>{pending?'Saving…':'Sign documentation'}</button></form></section>
    <section className="panel"><h3>Documentation history</h3>{data.entries?.length ? data.entries.map(e=><article className="alert-item" key={e.id}><strong>{e.kind}</strong><p>{e.author_name} · {time(e.created_at)}</p>{Object.entries(e.payload).map(([key,value])=><p key={key}>{key.replaceAll('_',' ')}: {String(value ?? 'Not recorded')}</p>)}{e.supersedes && <p>Corrects record {e.supersedes}<br/>Reason: {e.correction_reason}</p>}{data.entries.some(c=>c.supersedes===e.id)&&<p>Preserved original · corrected by a later entry</p>}</article>) : <p>No signed documentation yet.</p>}</section>
  </>;
}
