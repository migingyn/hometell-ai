'use client';
import { useState } from 'react';
import { PatientWorkspace } from '../components/operations/PatientWorkspace';
import { useCare } from './care-context';

export default function CallEvidence({check,client,onSaved}) {
  const {setError,refresh,useMock}=useCare();
  const [busy,setBusy]=useState(false);
  if(!check)return <p>No outreach evidence recorded for this resident yet.</p>;
  async function act(path,body) {
    setBusy(true);
    try {
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'The record could not be updated.');
      await refresh();await onSaved?.();
    } catch(error){setError(error.message);throw error;} finally{setBusy(false);}
  }
  return <section className="ops-app" style={{minHeight:0,borderRadius:8}} aria-label="Shared outreach evidence">
    <PatientWorkspace check={{...check,client:{...client,phone:'',emergency_contact_phone:''}}} mode={check.mode||(check.postop_assessment?'daily':'crisis')} busy={busy} mockMode={useMock} allowAdvance={!check.simulated_replay}
      onHandled={id=>{void act(`/api/checks/${id}/handled`).catch(()=>{});}}
      onAdvance={id=>{void act(`/api/ladder/advance/${id}`).catch(()=>{});}}
      onReview={(id,callId,reviewer)=>act(`/api/checks/${id}/postop-review`,{call_id:callId,reviewer})}/>
  </section>;
}
