// Server-only adapter: one persisted roster for nursing and outreach screens.
import { config } from '../config';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { getCheckWithClient, getCheckEvent } from '../checks';
import { placeCall } from '../retell';
import { demoCarePlan, latestVitals, roundsState, prepareCallContext, validateVitals } from '../../frontend/vitals-model';

export class CareError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CareError(z.prettifyError(parsed.error));
  return parsed.data;
}
async function query(result) {
  const {data,error} = await result;
  if (error) throw new CareError(error.code === '23505' ? 'This record was already saved or corrected. Refresh before retrying.' : error.message, error.code === '23505' ? 409 : 500);
  return data;
}
const UUID = z.string().uuid();
const shortText = z.string().trim().min(1).max(100);
const isActive = c => ['needs_human','no_answer'].includes(c.status);
function alertFor(check, client, ack) {
  return {id:check.id,client_id:client.id,name:client.name,room:client.room,
    urgency:check.urgency==='urgent'?'now':'today',type:check.flag_reason==='unreachable'?'unreachable':'follow_up',
    reason:check.flag_reason||check.summary||'A person needs to review this check-in.',
    quote:check.priority_assessment?.evidence?.find(e=>e.kind==='situation')?.quote,
    created_at:check.updated_at, acknowledged_at:ack?.acknowledged_at,acknowledged_by:ack?.acknowledged_by};
}
export async function workspace(role, selectedFacility) {
  const db=supabaseAdmin();
  const [raw, profiles, rawChecks, vitals, notes, acks, facilities, settings, staff, events] = await Promise.all([
    query(db.from('clients_public').select('*')),query(db.from('care_profiles').select('*')),
    query(db.from('checks').select('*').order('updated_at',{ascending:false})),
    query(db.from('care_vitals').select('*').order('measured_at',{ascending:false})),
    query(db.from('care_notes').select('*').order('created_at',{ascending:false})),
    query(db.from('care_acknowledgements').select('*')),query(db.from('care_facilities').select('*').order('id')),
    query(db.from('care_settings').select('*').eq('id','organization').single()),query(db.from('care_staff').select('*').order('name')),query(db.from('events').select('id,type,alert_text')),
  ]);
  const checks=rawChecks.map(c=>{const event=events.find(e=>e.id===c.event_id);return {...c,mode:event?.type==='daily'?'daily':'crisis',simulated_replay:event?.alert_text?.startsWith('SIMULATED DISASTER REPLAY')||false};});
  const facilityId=role==='nurse'?'hollywood':selectedFacility;
  const roster=raw.map(client=>{
    const profile=profiles.find(p=>p.client_id===client.id);
    const ownNotes=notes.filter(n=>n.resident_id===client.id);
    const replaced=new Set(ownNotes.map(n=>n.supersedes).filter(Boolean));
    const reminder=ownNotes.find(n=>n.kind==='reminders'&&!replaced.has(n.id));
    const current=checks.filter(c=>c.client_id===client.id);
    const last=current[0];
    const lastDaily=current.find(c=>c.postop_assessment)?.postop_assessment;
    const open=current.filter(isActive).filter(c=>!acks.some(a=>a.check_id===c.id&&a.call_id===c.last_call_id));
    const plan=profile?.care_plan||demoCarePlan(0);
    const records=vitals.filter(v=>v.resident_id===client.id);
    return {...client,...profile,id:client.id,organization_id:'heartbeat-fictional-demo',
      facility_id:profile?.facility_id||'hollywood',room:profile?.room||'Not assigned',care_plan:plan,
      nurse_id:profile?.nurse_id||'demo-nurse',nurse_name:staff.find(s=>s.id===profile?.nurse_id)?.name||profile?.nurse_name,
      aide_id:profile?.aide_id,aide_name:staff.find(s=>s.id===profile?.aide_id)?.name||profile?.aide_name,
      latest_check:last||null,allergies:profile?.allergies||[],med_schedule_now:reminder?.payload.text||'',
      card_status:open.some(c=>c.urgency==='urgent')?'red':open.length?'yellow':last?.status==='ok'||last?.status==='handled'?'green':'gray',
      card_reason:last?.flag_reason||last?.summary||'No check-in outcome recorded.',last_call_at:last?.updated_at||null,
      last_pain_level:lastDaily?.answers?.pain?.status==='reported'?lastDaily.answers.pain.value:null,last_mood:null,open_alert_count:open.length,
      rounds:roundsState(records,plan,open.length),vitals_status:records.length?'recorded':'not_recorded'};
  }).filter(c=>!facilityId||c.facility_id===facilityId);
  const ids=new Set(roster.map(c=>c.id));
  const scoped=checks.filter(c=>ids.has(c.client_id));
  const alerts=scoped.filter(isActive).map(c=>alertFor(c,roster.find(r=>r.id===c.client_id),acks.find(a=>a.check_id===c.id&&a.call_id===c.last_call_id)));
  return {roster,checks:scoped,vitals:vitals.filter(v=>ids.has(v.resident_id)),notes:notes.filter(n=>ids.has(n.resident_id)),alerts,
    facilities:facilities.filter(f=>role!=='nurse'||f.id==='hollywood').map(f=>({...f,residents:profiles.filter(p=>p.facility_id===f.id).length,staff:staff.filter(s=>s.facility_id===f.id).length})),
    staff:staff.filter(s=>!s.facility_id||s.facility_id===(facilityId||s.facility_id)),settings};
}
function resident(state,id) {
  parse(UUID,id);
  const client=state.roster.find(c=>c.id===id);
  if (!client) throw new CareError('Resident is not in this workspace.',404);
  return client;
}
function nurseOnly(role) { if(role!=='nurse') throw new CareError('Choose the Nurse workspace for clinical documentation.',403); }
function adminOnly(role) { if(role!=='administrator') throw new CareError('Choose the Administrator workspace for organization settings.',403); }
function vitalsFor(state,client) {
  const records=state.vitals.filter(v=>v.resident_id===client.id);
  return {records,latest:latestVitals(records,client.care_plan),...roundsState(records,client.care_plan,state.alerts.filter(a=>a.client_id===client.id&&!a.acknowledged_at).length)};
}
async function callsFor(state) {
  if(!state.checks.length)return [];
  const db=supabaseAdmin();
  const [logs,contexts]=await Promise.all([
    query(db.from('call_logs').select('id,check_id,retell_call_id,outcome,created_at').in('check_id',state.checks.map(c=>c.id)).order('created_at',{ascending:false}).limit(100)),
    query(db.from('care_call_contexts').select('*').in('resident_id',state.roster.map(c=>c.id))),
  ]);
  const result=logs.map(log=>{
    const check=state.checks.find(c=>c.id===log.check_id);
    return {id:log.retell_call_id,check_id:check.id,client_id:check.client_id,status:log.outcome,created_at:log.created_at,
      summary:check.last_call_id===log.retell_call_id?check.summary:'Saved call result; open evidence to review.',context:contexts.find(c=>c.call_id===log.retell_call_id)?.context};
  });
  for(const check of state.checks)if(check.last_call_id&&!result.some(c=>c.id===check.last_call_id))result.push({id:check.last_call_id,check_id:check.id,client_id:check.client_id,status:check.status,created_at:contexts.find(c=>c.call_id===check.last_call_id)?.created_at||check.updated_at,summary:check.summary||'Call requested; awaiting recorded results.',context:contexts.find(c=>c.call_id===check.last_call_id)?.context});
  return result.map(call=>{const client=state.roster.find(c=>c.id===call.client_id);return {...call,name:client.name,room:client.room};}).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
}
const Draft=z.object({measured_at:z.string().min(1).max(60),source:z.string().trim().min(1).max(300),observations:z.string().max(4000).optional(),confirmed:z.boolean().optional(),supersedes:UUID.optional(),correction_reason:z.string().max(1000).optional()}).passthrough();
export async function careRequest(path,body,role,url) {
  const db=supabaseAdmin();
  const state=await workspace(role,url.searchParams.get('facility_id'));
  const [resource,id,action]=path;
  const write=body!==undefined;
  const workspaceConfig={agency_name:state.settings.name,mockMode:config.mockRetell,fictionalData:process.env.FICTIONAL_CLIENTS!=='false'};
  if(resource==='config'&&!write)return workspaceConfig;
  if(resource==='staff'&&!write)return state.staff;
  if(resource==='workspace'&&!write) {
    const tasks=state.roster.length?await query(db.from('care_tasks').select('*').in('resident_id',state.roster.map(c=>c.id)).order('due_at')):[];
    return {config:workspaceConfig,clients:state.roster,facilities:state.facilities,staff:state.staff,checks:state.checks,alerts:state.alerts.filter(a=>!a.acknowledged_at),calls:await callsFor(state),tasks:tasks.map(t=>({...t,resident:state.roster.find(c=>c.id===t.resident_id),assignee:state.staff.find(s=>s.id===t.assigned_to)}))};
  }
  if(resource==='facilities'&&!write)return state.facilities;
  if(resource==='clients'&&!id&&!write)return state.roster;
  if(resource==='metrics'&&!write) {
    const calls=await callsFor(state);
    return {facilities:state.facilities.length,residents:state.roster.length,staff:state.staff.length,missing_documentation:state.roster.filter(c=>c.rounds.status!=='Recorded').length,unresolved_follow_ups:state.alerts.filter(a=>!a.acknowledged_at).length,call_outcomes:Object.fromEntries([...new Set(calls.map(c=>c.status))].map(status=>[status,calls.filter(c=>c.status===status).length]))};
  }
  if(resource==='calls'&&!write)return (await callsFor(state)).slice(0,100);
  if(resource==='crisis'&&id==='current'&&!write)return {run:null}; // Active crisis control lives in the shared outreach workspace.
  if(resource==='alerts'&&!write)return state.alerts.filter(a=>url.searchParams.get('open')!=='true'||!a.acknowledged_at);
  if(resource==='alerts'&&id&&action==='ack'&&write) {
    const alert=state.alerts.find(a=>a.id===id);
    if(!alert)throw new CareError('Alert not found in this workspace.',404);
    const data=parse(z.object({by:shortText}),body);
    const check=state.checks.find(c=>c.id===id);
    return query(db.from('care_acknowledgements').upsert({check_id:id,call_id:check.last_call_id,acknowledged_by:data.by,acknowledged_at:new Date().toISOString()}).select().single());
  }
  if(resource==='clients'&&id) {
    const client=resident(state,id);
    if(action==='vitals') {
      if(!write)return vitalsFor(state,client);
      nurseOnly(role);
      const draft=parse(z.object({draft:Draft}),body).draft;
      const validation=validateVitals(draft,client.care_plan);
      if(validation.errors.length)throw new CareError(validation.errors.join(' '));
      if(validation.warnings.length&&!draft.confirmed)throw new CareError('Review and confirm the possible entry mistakes before saving.');
      if(draft.supersedes&&!state.vitals.some(v=>v.id===draft.supersedes&&v.resident_id===id))throw new CareError('The original measurement does not belong to this resident.');
      return query(db.from('care_vitals').insert({resident_id:id,facility_id:client.facility_id,author:{id:'demo-nurse',name:'Jordan Lee (Demo)'},measured_at:validation.measured_at,readings:validation.readings,source:draft.source,observations:draft.observations||'',supersedes:draft.supersedes||null,correction_reason:draft.correction_reason||'',confirmed_entry_warnings:validation.warnings}).select().single());
    }
    if((action==='notes'||action==='reminders')&&write) {
      nurseOnly(role);
      const data=parse(z.object({text:z.string().trim().min(1).max(8000),supersedes:UUID.optional(),correction_reason:z.string().trim().max(1000).optional()}),body);
      const kind=action==='notes'?'note':'reminders';
      if(data.supersedes&&(!data.correction_reason||!state.notes.some(n=>n.id===data.supersedes&&n.resident_id===id&&n.kind===kind)))throw new CareError('A correction needs a reason and an original entry of the same kind for this resident.');
      return query(db.from('care_notes').insert({resident_id:id,kind,payload:{text:data.text},author_name:'Jordan Lee (Demo)',supersedes:data.supersedes||null,correction_reason:data.correction_reason||''}).select().single());
    }
    if(action==='call-context'&&!write)return prepareCallContext(client,state.vitals.filter(v=>v.resident_id===id),state.alerts.filter(a=>a.client_id===id&&!a.acknowledged_at));
    if(action==='call'&&write) {
      nurseOnly(role);
      const context=prepareCallContext(client,state.vitals.filter(v=>v.resident_id===id),state.alerts.filter(a=>a.client_id===id&&!a.acknowledged_at));
      const claimed=await query(db.rpc('start_care_daily_call',{p_client_id:id}));
      if(claimed.skipped)throw new CareError('This resident already has an active call. Review its status before requesting another.',409);
      return startCareCall(claimed.check,context);
    }
    if(!action&&!write) {
      const calls=(await callsFor(state)).filter(c=>c.client_id===id);
      const entries=state.notes.filter(n=>n.resident_id===id);
      return {client,next_call_context:prepareCallContext(client,state.vitals.filter(v=>v.resident_id===id),state.alerts.filter(a=>a.client_id===id&&!a.acknowledged_at)),card_status:client.card_status,card_reason:client.card_reason,vitals:vitalsFor(state,client),entries,last_calls:calls,open_alerts:state.alerts.filter(a=>a.client_id===id&&!a.acknowledged_at),alert_history:state.alerts.filter(a=>a.client_id===id&&a.acknowledged_at),trend:state.checks.filter(c=>c.client_id===id&&c.postop_assessment?.answers?.pain?.status==='reported').slice(0,7).reverse().map(c=>({date:c.postop_assessment.recorded_at.slice(0,10),pain_level:c.postop_assessment.answers.pain.value})),latest_check:state.checks.find(c=>c.client_id===id)||null};
    }
  }
  if(resource==='tasks') {
    const tasks=state.roster.length?await query(db.from('care_tasks').select('*').in('resident_id',state.roster.map(c=>c.id)).order('due_at')):[];
    if(!id&&!write)return tasks.map(t=>({...t,resident:state.roster.find(c=>c.id===t.resident_id),assignee:state.staff.find(s=>s.id===t.assigned_to)}));
    if(!id&&write) {
      const data=parse(z.object({resident_id:UUID,title:z.string().trim().min(1).max(300),due_at:z.string().datetime().optional(),assigned_to:z.string().max(100).optional()}),body);
      const client=resident(state,data.resident_id);
      data.assigned_to=data.assigned_to||client.nurse_id;
      if(!state.staff.some(s=>s.id===data.assigned_to&&(!s.facility_id||s.facility_id===client.facility_id)))throw new CareError('Choose a staff member for this facility.');
      return query(db.from('care_tasks').insert({...data,created_by:role==='nurse'?'demo-nurse':'demo-administrator'}).select().single());
    }
    const task=tasks.find(t=>t.id===id);
    if(!task)throw new CareError('Task not found in this workspace.',404);
    if(body?.assigned_to!==undefined) {
      const {assigned_to}=parse(z.object({assigned_to:z.string().min(1).max(100)}),body);
      const client=resident(state,task.resident_id);
      if(!state.staff.some(s=>s.id===assigned_to&&(!s.facility_id||s.facility_id===client.facility_id)))throw new CareError('Choose a staff member for this facility.');
      return query(db.from('care_tasks').update({assigned_to}).eq('id',id).select().single());
    }
    const {status}=parse(z.object({status:z.enum(['accepted','in_progress','completed'])}),body);
    if(({assigned:'accepted',accepted:'in_progress',in_progress:'completed'})[task.status]!==status)throw new CareError('Task changed. Refresh before continuing.',409);
    const result=await query(db.from('care_tasks').update({status}).eq('id',id).eq('status',task.status).select().maybeSingle());
    if(!result)throw new CareError('Task changed. Refresh before continuing.',409);
    return result;
  }
  if(resource==='schedules') {
    if(!write)return (await query(db.from('care_schedules').select('*'))).filter(s=>state.facilities.some(f=>f.id===s.facility_id)&&(!url.searchParams.get('facility_id')||s.facility_id===url.searchParams.get('facility_id'))).map(s=>({...s,facility:state.facilities.find(f=>f.id===s.facility_id)}));
    adminOnly(role);
    if(id) {
      parse(UUID,id);const data=parse(z.object({enabled:z.boolean()}),body);
      let update=db.from('care_schedules').update(data).eq('id',id);
      if(url.searchParams.get('facility_id'))update=update.eq('facility_id',url.searchParams.get('facility_id'));
      const result=await query(update.select().maybeSingle());
      if(!result)throw new CareError('Schedule not found.',404);return result;
    }
    const data=parse(z.object({facility_id:z.enum(['hollywood','pasadena','culver-city']),local_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),enabled:z.boolean()}),body);
    return query(db.from('care_schedules').upsert(data,{onConflict:'facility_id'}).select().single());
  }
  if(resource==='settings') {
    if(!write)return state.settings;
    adminOnly(role);
    const data=parse(z.object({name:z.string().trim().min(1).max(150),timezone:z.string().trim().min(1).max(100).refine(value=>{try {new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Enter a supported IANA timezone.')}),body);
    return query(db.from('care_settings').update(data).eq('id','organization').select().single());
  }
  throw new CareError('Care workspace endpoint not found.',404);
}

// Used by both single-resident requests and facility-wide daily rounds.
// Persist the exact pre-call context before attempting the provider request.
export async function startCareCall(check,prepared = undefined) {
  const db=supabaseAdmin();
  const withClient=await getCheckWithClient(check.id);
  if(!withClient)throw new CareError('Unknown check.',404);
  const event=await getCheckEvent(withClient);
  let savedContext;
  if(event.type==='daily') {
    let context=prepared;
    if(!context) {
      const state=await workspace('administrator');const client=resident(state,check.client_id);
      context=prepareCallContext(client,state.vitals.filter(v=>v.resident_id===client.id),state.alerts.filter(a=>a.client_id===client.id&&!a.acknowledged_at));
    }
    savedContext=await query(db.from('care_call_contexts').insert({call_id:`pending_${check.id}`,check_id:check.id,resident_id:check.client_id,context}).select().single());
  }
  try {
    const call=await placeCall({client:withClient.client,checkId:check.id,target:'client',event});
    if(savedContext)await query(db.from('care_call_contexts').update({call_id:call.callId}).eq('call_id',savedContext.call_id));
    await query(db.from('checks').update({status:'calling',last_call_id:call.callId}).eq('id',check.id).eq('status','queued'));
    return {call_id:call.callId,context:savedContext?.context};
  } catch(error) {
    await query(db.from('checks').update({status:'needs_human',urgency:'urgent',flag_reason:'Call could not be confirmed. Review before retrying.'}).eq('id',check.id).eq('status','queued'));
    throw error;
  }
}
