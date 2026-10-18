// Isolated local integration check. All created records belong to this run.
import './env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase';
import { buildFakeWebhook } from './fake-webhook';
import type {CheckWithClient} from '../lib/types';

const base=new URL(process.env.APP_URL||'http://localhost:3017');
const db=supabaseAdmin();
const groups:string[]=[];
async function request(path:string,body?:unknown,role='nurse') {
  const response=await fetch(new URL(`/api/care/${path}`,base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-heartbeat-demo-role':role},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  return {status:response.status,body:await response.json()};
}
async function api(path:string,body?:unknown,role='nurse') {
  const result=await request(path,body,role);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.ok,true);return result.body.data;
}
async function main() {
  assert.equal(process.env.MOCK_RETELL,'true');
  for(const url of [base,new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'')])assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const id=randomUUID();
  const created=await db.from('clients').insert({id,name:`Care verification ${id.slice(0,8)}`,phone:'+15550000999',risk_tier:'green',lives_alone:false,uses_powered_equipment:false,emergency_contact_name:'Fictional contact',emergency_contact_phone:'+15550001999'});
  assert.equal(created.error,null);
  try {
    assert.equal((await request('clients',undefined,'')).status,403);
    const roster=await api('clients');assert.ok(roster.some((c:{id:string})=>c.id===id));assert.ok(roster.every((c:{facility_id:string,phone?:string})=>c.facility_id==='hollywood'&&!c.phone));
    await db.from('care_profiles').update({facility_id:'pasadena'}).eq('client_id',id);
    assert.equal((await request(`clients/${id}`)).status,404);
    assert.ok((await api('clients?facility_id=pasadena',undefined,'administrator')).some((c:{id:string})=>c.id===id));
    await db.from('care_profiles').update({facility_id:'hollywood'}).eq('client_id',id);
    groups.push('Login role is required; nurse assignment and administrator facility filters use the shared roster without exposing phone numbers.');
    const draft={heart_rate:'72',measured_at:new Date(Date.now()-60000).toISOString(),source:'Fictional verification device',temperature_unit:'°F',weight_unit:'lb',glucose_unit:'mg/dL'};
    assert.equal((await request(`clients/${id}/vitals`,{draft:{...draft,heart_rate:'invalid'}})).status,400);
    assert.equal((await request(`clients/${id}/vitals`,{draft},'administrator')).status,403);
    const first=await api(`clients/${id}/vitals`,{draft});
    assert.equal((await api(`clients/${id}/vitals`)).latest.heart_rate.value,72);
    assert.equal((await api(`clients/${id}/vitals`)).status,'Due');
    const correction={...draft,heart_rate:'74',supersedes:first.id,correction_reason:'Corrected fictional transcription'};
    await api(`clients/${id}/vitals`,{draft:correction});
    assert.equal((await request(`clients/${id}/vitals`,{draft:correction})).status,409);
    const saved=await api(`clients/${id}/vitals`);assert.equal(saved.records.length,2);assert.equal(saved.latest.heart_rate.value,74);
    assert.equal((await request(`clients/${id}/vitals`,{draft:{...correction,supersedes:randomUUID()}})).status,400);
    groups.push('Vitals persist, invalid readings are rejected, partial entries stay due, and corrections preserve originals with duplicate/cross-record rejection.');
    const note=await api(`clients/${id}/notes`,{text:'Fictional verification note'});
    await api(`clients/${id}/notes`,{text:'Corrected fictional note',supersedes:note.id,correction_reason:'Verification'});
    await api(`clients/${id}/reminders`,{text:'Staff-approved fictional reminder.'});
    assert.equal((await api(`clients/${id}`)).entries.length,3);
    const task=await api('tasks',{resident_id:id,title:'Verify fictional follow-up',assigned_to:'demo-aide-hollywood'});
    assert.equal(task.assigned_to,'demo-aide-hollywood');
    assert.equal((await api('workspace')).tasks.find((t:{id:string})=>t.id===task.id).assignee.id,'demo-aide-hollywood');
    assert.equal((await request(`tasks/${task.id}`,{assigned_to:'demo-nurse-pasadena'})).status,400);
    await api(`tasks/${task.id}`,{assigned_to:'demo-nurse'});
    assert.equal((await api('workspace')).tasks.find((t:{id:string})=>t.id===task.id).assigned_to,'demo-nurse');
    assert.equal((await request(`tasks/${task.id}`,{status:'completed'})).status,409);
    for(const status of ['accepted','in_progress','completed']) {
      await api(`tasks/${task.id}`,{status});
      assert.equal((await api('workspace')).tasks.find((t:{id:string})=>t.id===task.id).status,status);
      assert.equal((await api('tasks')).find((t:{id:string})=>t.id===task.id).status,status);
    }
    groups.push('Notes/reminders and staff-linked tasks persist; assignment and status agree across the shared workspace and follow-up queue; transitions cannot skip required steps.');
    const concurrent=await Promise.all([request(`clients/${id}/call`,{}),request(`clients/${id}/call`,{})]);
    assert.deepEqual(concurrent.map(c=>c.status).sort(),[200,409],JSON.stringify(concurrent));
    const context=concurrent.find(c=>c.status===200)!.body.data.context;
    assert.equal(context.raw_measurements.heart_rate.value,74);assert.equal(context.staff_approved_instructions,'Staff-approved fictional reminder.');
    await api(`clients/${id}/vitals`,{draft:{...draft,heart_rate:'76',measured_at:new Date().toISOString()}});
    const calls=await api('calls');const call=calls.find((c:{client_id:string})=>c.client_id===id);
    assert.equal(call.context.raw_measurements.heart_rate.value,74);
    const current=await db.from('checks').select('*,client:clients(*)').eq('id',call.check_id).single();assert.equal(current.error,null);
    const webhook=await fetch(new URL('/api/retell/webhook',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildFakeWebhook(current.data as CheckWithClient,'follow_up','client','daily'))});
    assert.equal(webhook.status,200);
    const profile=await api(`clients/${id}`);assert.equal(profile.latest_check.status,'needs_human');assert.ok(profile.latest_check.postop_assessment);
    assert.equal(profile.latest_check.mode,'daily');
    const review=await fetch(new URL(`/api/checks/${profile.latest_check.id}/postop-review`,base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({call_id:profile.latest_check.last_call_id,reviewer:'Verification nurse'})});
    assert.equal(review.status,200);
    assert.equal((await api(`clients/${id}`)).latest_check.postop_assessment.suggested_next_step.status,'approved');
    const alert=profile.open_alerts[0];assert.ok(alert);
    await api(`alerts/${alert.id}/ack`,{by:'Verification nurse'});
    assert.equal((await api(`clients/${id}`)).latest_check.status,'needs_human');
    assert.equal((await api(`clients/${id}`)).alert_history.length,1);
    groups.push('Concurrent calls are deduplicated, immutable pre-call snapshots feed call history, webhook evidence reaches the resident profile, and acknowledgement does not resolve care.');
    console.log(`Care workspace verification passed (${groups.length} scenario groups). No real calls or texts were placed.`);
  } finally {
    const {data:checks}=await db.from('checks').select('event_id').eq('client_id',id);
    for(const eventId of new Set((checks||[]).map(c=>c.event_id))) {
      const others=await db.from('checks').select('id').eq('event_id',eventId).neq('client_id',id).limit(1);
      assert.equal(others.error,null);
      // A manually started round could include this temporary fixture. Never delete a shared event.
      if(!others.data?.length){const result=await db.from('events').delete().eq('id',eventId);assert.equal(result.error,null);}
    }
    const result=await db.from('clients').delete().eq('id',id);assert.equal(result.error,null);
  }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
