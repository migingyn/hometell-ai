// Shared demo calculations. Entry checks do not diagnose or create clinical alerts.
export const VITAL_FIELDS = [
  {key:'bp_sys',label:'Systolic blood pressure',unit:'mmHg',group:'blood_pressure'},
  {key:'bp_dia',label:'Diastolic blood pressure',unit:'mmHg',group:'blood_pressure'},
  {key:'heart_rate',label:'Heart rate',unit:'bpm'},
  {key:'temperature',label:'Temperature',units:['°F','°C'],unitKey:'temperature_unit'},
  {key:'spo2',label:'Oxygen saturation',unit:'%'},
  {key:'respiratory_rate',label:'Respiratory rate',unit:'breaths/min'},
  {key:'weight',label:'Weight',units:['lb','kg'],unitKey:'weight_unit'},
  {key:'blood_glucose',label:'Blood glucose',units:['mg/dL','mmol/L'],unitKey:'glucose_unit'},
];
export function demoCarePlan(index) {
  return {fields:VITAL_FIELDS.filter(f=>f.key!=='blood_glucose'||index===0).map(f=>f.key),
    temperature_unit:'°F',weight_unit:'lb',glucose_unit:'mg/dL',max_age_hours:24,
    timezone:'America/Los_Angeles',clinical_thresholds:{}};
}
export function localDateTime(date=new Date()) {
  const pad=n=>String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function fieldUnit(field,values) {return field.unit || values[field.unitKey];}
export function validateVitals(draft,plan,now=new Date()) {
  const errors=[];const warnings=[];const readings={};
  for(const field of VITAL_FIELDS.filter(f=>plan.fields.includes(f.key))) {
    const raw=String(draft[field.key]??'').trim();
    if(!raw)continue;
    if(!/^\d+(\.\d+)?$/.test(raw)||!Number.isFinite(Number(raw))||Number(raw)<=0) {errors.push(`${field.label} must be a positive number.`);continue;}
    const unit=fieldUnit(field,draft);
    if(field.units&&!field.units.includes(unit)){errors.push(`Choose the ${field.label.toLowerCase()} unit.`);continue;}
    readings[field.key]={value:Number(raw),unit};
    if(raw.split('.')[0].length>3)warnings.push(`${field.label} has four or more digits. Check the value and unit.`);
  }
  if(!Object.keys(readings).length)errors.push('Enter at least one reading. Partial entries are welcome.');
  const measured=new Date(draft.measured_at);
  if(!draft.measured_at||Number.isNaN(measured.getTime()))errors.push('Enter a valid measurement date and time.');
  else {
    if(measured.getTime()>now.getTime()+5*60000)warnings.push('The measurement time is in the future. Check the date and time.');
    if(now.getTime()-measured.getTime()>7*86400000)warnings.push('The measurement is more than seven days old. Check the date and time.');
  }
  if(!String(draft.source||'').trim())errors.push('Enter the measurement source or method.');
  if(String(draft.source||'').length>300)errors.push('Keep the source or method under 300 characters.');
  if(String(draft.observations||'').length>4000)errors.push('Keep observations under 4,000 characters.');
  if(readings.spo2?.value>100)warnings.push('Oxygen saturation exceeds 100%. Check the entry.');
  if(readings.bp_sys&&readings.bp_dia&&readings.bp_dia.value>=readings.bp_sys.value)warnings.push('Diastolic is equal to or higher than systolic. Check both blood pressure values.');
  if(draft.supersedes&&!String(draft.correction_reason||'').trim())errors.push('A correction requires a reason.');
  return {errors,warnings,readings,measured_at:errors.some(e=>e.includes('date and time'))?null:measured.toISOString()};
}
export function activeVitals(records) {
  const replaced=new Set(records.map(r=>r.supersedes).filter(Boolean));
  return records.filter(r=>!replaced.has(r.id));
}
export function latestVitals(records,plan,now=new Date()) {
  const latest={};
  const ordered=activeVitals(records).sort((a,b)=>Date.parse(b.measured_at)-Date.parse(a.measured_at)||Date.parse(b.entered_at)-Date.parse(a.entered_at));
  for(const record of ordered)for(const [key,reading] of Object.entries(record.readings)) {
    if(!latest[key])latest[key]={...reading,measured_at:record.measured_at,entered_at:record.entered_at,source:record.source,author:record.author,record_id:record.id,
      freshness:Date.parse(record.measured_at)>now.getTime()+5*60000?'future':now.getTime()-Date.parse(record.measured_at)>plan.max_age_hours*3600000?'outdated':'current'};
  }
  return latest;
}
export function clinicalFlags(latest,plan) {
  return Object.entries(plan.clinical_thresholds||{}).flatMap(([key,threshold])=>{
    const reading=latest[key];
    if(!reading||reading.freshness!=='current'||reading.unit!==threshold.unit)return [];
    return (threshold.min!=null&&reading.value<threshold.min)||(threshold.max!=null&&reading.value>threshold.max) ? [{key,reason:threshold.reason||'Outside a staff-configured threshold.'}] : [];
  });
}
export function roundsState(records,plan,openAlerts=0,now=new Date()) {
  const latest=latestVitals(records,plan,now);
  const day=date=>new Date(date).toLocaleDateString('en-CA',{timeZone:plan.timezone});
  const recorded=plan.fields.filter(key=>latest[key]?.freshness==='current'&&day(latest[key].measured_at)===day(now));
  const flags=clinicalFlags(latest,plan);
  const missing=plan.fields.filter(key=>!recorded.includes(key));
  return {status:openAlerts||flags.length?'Follow-up needed':missing.length?'Due':'Recorded',missing,recorded:recorded.length,total:plan.fields.length,latest,flags};
}
export function prepareCallContext(client,records,followUps,now=new Date()) {
  const latest=latestVitals(records,client.care_plan,now);
  return {prepared_at:now.toISOString(),resident:{id:client.id,name:client.name,room:client.room,facility_id:client.facility_id,organization_id:client.organization_id},
    raw_measurements:latest,missing_fields:client.care_plan.fields.filter(key=>!latest[key]),
    outdated_fields:Object.keys(latest).filter(key=>latest[key].freshness!=='current'),
    staff_approved_instructions:client.med_schedule_now||'No staff-approved instructions documented.',
    outstanding_follow_ups:followUps.map(a=>({id:a.id,reason:a.reason,urgency:a.urgency,created_at:a.created_at})),
    communication_rules:['Deliver only staff-approved reminders and collect responses.','Do not diagnose, change medication, or invent clinical advice.','Missing, future-dated, or outdated readings are not evidence that a resident is well.','New documentation informs subsequent simulated calls; active calls do not receive these updates.'],
    ai_summary:null};
}
