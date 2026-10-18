'use client';
import {useState} from 'react';
import {Plus} from 'lucide-react';
import {useCare} from './care-context';
export default function TaskComposer({residentId,onSaved}){
 const care=useCare();const [chosen,setChosen]=useState(residentId||'');const [message,setMessage]=useState('');const [saving,setSaving]=useState(false);
 const resident=care.clients.find(c=>c.id===(chosen||care.clients[0]?.id));
 const staff=care.staff.filter(s=>!s.facility_id||s.facility_id===resident?.facility_id);
 return <section className="panel"><div className="section-heading"><h2>Create a follow-up</h2><Plus size={17} color="#087e76"/></div><p className="muted">Assign the next human action to a member of this care team.</p><form onSubmit={async event=>{
  event.preventDefault();const form=event.currentTarget;const values=new FormData(form);setSaving(true);setMessage('');
  try{await care.perform('/api/tasks',{resident_id:resident.id,title:values.get('title'),assigned_to:values.get('assigned_to'),...(values.get('due_at')?{due_at:new Date(values.get('due_at')).toISOString()}: {})});form.reset();setMessage('Follow-up saved in the resident record and task queue.');await onSaved?.();}
  catch(error){setMessage(error.message);}finally{setSaving(false);}
 }}><div className="form-grid">{!residentId&&<label>Resident<select value={chosen||care.clients[0]?.id||''} onChange={event=>setChosen(event.target.value)} required>{care.clients.map(c=><option key={c.id} value={c.id}>{c.room} · {c.name}</option>)}</select></label>}
 <label>Assign to<select name="assigned_to" defaultValue={resident?.nurse_id||care.account.user_id} required>{staff.map(s=><option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}</select></label><label>Due date and time (optional)<input type="datetime-local" name="due_at"/></label></div>
 <label>Follow-up task<input name="title" required maxLength={300} placeholder="Describe the next staff action"/></label><button className="dark" disabled={saving||!resident}>{saving?'Saving…':'Create assigned task'} <Plus size={13}/></button><p role="status" className="save-status">{message}</p></form></section>;
}
