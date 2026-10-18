'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCare } from './care-context';
import { request } from './api';
import { time } from './ui';
import { VITAL_FIELDS, activeVitals, localDateTime, validateVitals } from './vitals-model';

export function ReadingsList({latest}) {
  const available=VITAL_FIELDS.filter(f=>latest[f.key]);
  return available.length ? <dl className="vital-readings">{available.map(field=>{const reading=latest[field.key];return <div key={field.key}><dt>{field.label}</dt><dd><strong>{reading.value} {reading.unit}</strong><span>{time(reading.measured_at)} · {reading.freshness}</span><span>{reading.source} · {reading.author.name}</span></dd></div>;})}</dl> : <p className="empty">No readings recorded. Missing measurements are not normal readings.</p>;
}
export function VitalsHistory({records,onCorrect}) {
  const corrected=new Set(records.map(r=>r.supersedes).filter(Boolean));
  return <section className="panel"><h2>Measurement history</h2>{records.length ? records.map(record=><article className="vitals-history-entry" key={record.id}>
    <div className="section-heading"><div><strong>Measured {time(record.measured_at)}</strong><p className="muted">Entered {time(record.entered_at)} · {record.author.name}</p></div>{corrected.has(record.id)?<span className="badge">Original · corrected</span>:onCorrect&&<button onClick={()=>onCorrect(record)}>Correct entry</button>}</div>
    <p className="muted">Source / method: {record.source}</p><dl className="facts">{VITAL_FIELDS.filter(f=>record.readings[f.key]).map(field=><div key={field.key}><dt>{field.label}</dt><dd>{record.readings[field.key].value} {record.readings[field.key].unit}</dd></div>)}</dl>
    {record.observations&&<p>Observations: {record.observations}</p>}{record.supersedes&&<p className="correction-note">Correction of {record.supersedes}<br/>Reason: {record.correction_reason}</p>}
  </article>) : <p className="empty">No measurement history yet.</p>}</section>;
}

export function VitalsWorkflow() {
  const params=useSearchParams();
  const preselected=params.get('resident')||'';
  return <VitalsWorkspace key={preselected} preselected={preselected}/>;
}
function VitalsWorkspace({preselected}) {
  const router=useRouter();
  const {clients,loading}=useCare();
  const [residentId,setResidentId]=useState(preselected);
  const [search,setSearch]=useState('');
  const resident=clients.find(c=>c.id===residentId);
  const filtered=clients.filter(c=>`${c.name} ${c.room}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="section-heading"><div><h2>Record vitals</h2><p className="muted">Fictional readings are saved in the shared local Supabase database.</p></div><Link href="/daily-rounds">Back to Daily Rounds</Link></div>
    <section className="panel resident-picker"><label>Find assigned resident<input type="search" placeholder="Search name or room" value={search} onChange={event=>setSearch(event.target.value)}/></label><label>Assigned resident<select value={residentId} onChange={event=>{const id=event.target.value;setResidentId(id);router.replace(id?`/record-vitals?resident=${encodeURIComponent(id)}`:'/record-vitals');}}><option value="">Choose a resident</option>{resident&&!filtered.some(c=>c.id===resident.id)&&<option value={resident.id}>{resident.room} · {resident.name} (selected)</option>}{filtered.map(c=><option key={c.id} value={c.id}>{c.room} · {c.name}</option>)}</select></label>{!filtered.length&&<p>No assigned residents match this search.</p>}</section>
    {loading ? <p>Loading assigned residents…</p> : resident ? <ResidentVitalsForm key={resident.id} resident={resident}/> : <section className="panel"><h3>Choose an assigned resident to begin</h3><p>No readings are entered until you choose the resident, room, and facility above.</p></section>}
  </>;
}
function blankDraft(plan) {return {measured_at:localDateTime(),source:'',observations:'',temperature_unit:plan.temperature_unit,weight_unit:plan.weight_unit,glucose_unit:plan.glucose_unit};}
function ResidentVitalsForm({resident}) {
  const {account,refresh,facilities}=useCare();
  const [draft,setDraft]=useState(()=>blankDraft(resident.care_plan));
  const [saved,setSaved]=useState(null);
  const [loadError,setLoadError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [errors,setErrors]=useState([]);
  const [warnings,setWarnings]=useState([]);
  const [confirmed,setConfirmed]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const [correction,setCorrection]=useState(null);
  const facility=facilities.find(f=>f.id===resident.facility_id);
  useEffect(()=>{
    let active=true;
    request(`/api/clients/${resident.id}/vitals`).then(data=>{if(active){setSaved(data);setLoadError('');}}).catch(err=>{if(active)setLoadError(err.message);});
    return()=>{active=false;};
  },[resident.id,attempt]);
  function change(key,value) {setDraft(previous=>({...previous,[key]:value}));setConfirmed(false);setWarnings([]);setMessage('');}
  function correct(record) {
    const next={...blankDraft(resident.care_plan),measured_at:localDateTime(new Date(record.measured_at)),source:record.source,observations:record.observations,supersedes:record.id,correction_reason:''};
    for(const field of VITAL_FIELDS)if(record.readings[field.key]) {next[field.key]=String(record.readings[field.key].value);if(field.unitKey)next[field.unitKey]=record.readings[field.key].unit;}
    setDraft(next);setCorrection(record);setConfirmed(false);setWarnings([]);setErrors([]);setMessage('Correction opened. The original stays in history.');
    document.getElementById('vitals-form-heading')?.scrollIntoView({behavior:'smooth',block:'start'});
    document.getElementById('correction-reason')?.focus();
  }
  async function save(event) {
    event.preventDefault();setMessage('');
    const validation=validateVitals(draft,resident.care_plan);
    setErrors(validation.errors);setWarnings(validation.warnings);
    if(validation.errors.length||validation.warnings.length&&!confirmed)return;
    setSaving(true);
    try {
      const record=await request(`/api/clients/${resident.id}/vitals`,{draft:{...draft,confirmed},actor:account});
      // The server returns only after the database commits.
      setMessage(`Saved to shared records for ${resident.name}, room ${resident.room}. Measured ${time(record.measured_at)}.`);
      setCorrection(null);setDraft(blankDraft(resident.care_plan));setConfirmed(false);setWarnings([]);
      try {setSaved(await request(`/api/clients/${resident.id}/vitals`));await refresh();}
      catch {setLoadError('The entry was saved, but the view could not refresh. Reload history to see it.');}
    } catch(err) {setErrors([err.message]);}
    finally {setSaving(false);}
  }
  const fields=VITAL_FIELDS.filter(f=>resident.care_plan.fields.includes(f.key));
  return <>
    <section className="resident-confirmation"><span className="room">{resident.room}</span><div><p className="eyebrow">RECORDING FOR</p><h2>{resident.name}</h2><p>{facility?.name} · Fictional demo resident</p></div></section>
    {loadError&&<div className="error-message" role="alert">{loadError} <button onClick={()=>setAttempt(value=>value+1)}>Reload history</button></div>}
    <div className="vitals-workspace"><section className="panel vitals-entry-panel"><h2 id="vitals-form-heading" tabIndex={-1}>{correction?'Correct measurement entry':'New measurement entry'}</h2><p className="muted">Leave unmeasured fields blank. Values below are empty for each new entry.</p>
      <form onSubmit={save} noValidate>
        <fieldset disabled={saving}><legend className="sr-only">Measurement details</legend>
        {correction&&<div className="correction-note"><p>Correcting {time(correction.measured_at)} · Original entry preserved.</p><label htmlFor="correction-reason">Reason for correction<input id="correction-reason" value={draft.correction_reason||''} onChange={event=>change('correction_reason',event.target.value)} maxLength={1000}/></label><button type="button" onClick={()=>{setCorrection(null);setDraft(blankDraft(resident.care_plan));setErrors([]);setWarnings([]);}}>Cancel correction</button></div>}
        <label>Measurement date and time (your local time)<input type="datetime-local" value={draft.measured_at} onChange={event=>change('measured_at',event.target.value)} required/></label>
        <div className="form-grid">{fields.map(field=><div key={field.key}><label htmlFor={`reading-${field.key}`}>{field.label}{field.unit?` (${field.unit})`:''}</label><div className="reading-input"><input id={`reading-${field.key}`} type="text" inputMode="decimal" placeholder="Not measured" value={draft[field.key]||''} onChange={event=>change(field.key,event.target.value)} autoComplete="off"/>{field.units&&<label><span className="sr-only">{field.label} unit</span><select value={draft[field.unitKey]} onChange={event=>change(field.unitKey,event.target.value)}>{field.units.map(unit=><option key={unit}>{unit}</option>)}</select></label>}</div></div>)}</div>
        <label>Measurement source or method<input value={draft.source} onChange={event=>change('source',event.target.value)} placeholder="For example: bedside devices, entered manually" maxLength={300} required/></label>
        <label>Observations (optional)<textarea rows={3} value={draft.observations} onChange={event=>change('observations',event.target.value)} maxLength={4000}/></label>
        <p className="muted">Demo author: {account.name}. Entry time is recorded separately when saved.</p>
        {errors.length>0&&<div className="error-message" role="alert"><strong>Check this entry</strong><ul>{errors.map(error=><li key={error}>{error}</li>)}</ul></div>}
        {warnings.length>0&&<div className="entry-review" role="alert"><strong>Possible entry mistakes — please confirm</strong><ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul><p>These are entry checks, not a clinical assessment. Values will be saved exactly as entered.</p><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I checked the values, units, and measurement time.</label></div>}
        <button className="dark" type="submit">{saving?'Saving to local database…':correction?'Save correction':'Save vitals'}</button>
        </fieldset>
        <p className="save-status" role="status">{message}</p>
      </form>
    </section><aside className="panel recent-vitals"><h2>Recent readings · reference only</h2><p className="muted">Sorted by measurement time. Reference values never fill a new entry.</p>{saved?<ReadingsList latest={saved.latest}/>:<p>{loadError?'History unavailable.':'Loading saved readings…'}</p>}<p className="muted">No clinical thresholds are configured in this fictional care plan. Readings are not automatically labeled normal.</p></aside></div>
    <VitalsHistory records={saved?.records||[]} onCorrect={correct}/>
  </>;
}

export function VitalsTrend({records}) {
  const [metric,setMetric]=useState('heart_rate');
  const points=activeVitals(records).filter(r=>r.readings[metric]).sort((a,b)=>Date.parse(a.measured_at)-Date.parse(b.measured_at));
  const unit=points.at(-1)?.readings[metric].unit;
  const recent=points.filter(r=>r.readings[metric].unit===unit).slice(-7);
  const values=recent.map(r=>r.readings[metric].value);
  const min=Math.min(...values),max=Math.max(...values);
  const coords=values.map((value,i)=>`${25+i*260/Math.max(1,values.length-1)},${90-(value-min)*60/Math.max(1,max-min)}`);
  return <section className="panel"><h2>Measured vitals trend</h2><label>Measurement<select value={metric} onChange={event=>setMetric(event.target.value)}>{VITAL_FIELDS.map(field=><option key={field.key} value={field.key}>{field.label}</option>)}</select></label>{recent.length<2?<p>Record at least two readings of this measurement in the same unit to show a trend.</p>:<><svg className="trend" viewBox="0 0 320 120" role="img" aria-label={`${VITAL_FIELDS.find(f=>f.key===metric).label} trend in ${unit}, ordered by measurement time`}><path d="M25 15V95H300" stroke="#bdcbc2" fill="none"/><polyline points={coords.join(' ')} fill="none" stroke="var(--ops-teal)" strokeWidth="3"/>{coords.map((point,i)=>{const[x,y]=point.split(',');return <circle key={recent[i].id} cx={x} cy={y} r="4" fill="var(--ops-teal)"/>;})}</svg><div className="trend-days">{recent.map(r=><div key={r.id}><strong>{r.readings[metric].value} {unit}</strong><small>{time(r.measured_at)}</small></div>)}</div></>}</section>;
}
