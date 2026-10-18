-- One explicitly authorized teammate call can replace one completed sample case.
-- Private interim evidence is separate from call_logs (the final-analysis ledger).
create table if not exists heartbeat_rehearsals (
  request_id uuid primary key,
  session_id uuid not null,
  event_id uuid not null unique references events(id) on delete cascade,
  check_id uuid not null unique references checks(id) on delete cascade,
  agent_id text not null,
  call_id text unique,
  status text not null default 'reserved' check(status in ('reserved','requested','ongoing','ended','analyzed','unknown','error')),
  turns jsonb not null default '[]'::jsonb,
  transcript text,
  turn_count integer not null default 0,
  raw jsonb,
  recording_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table heartbeat_rehearsals enable row level security;
revoke all on heartbeat_rehearsals from anon, authenticated;
grant all on heartbeat_rehearsals to service_role;

create or replace function reserve_heartbeat_rehearsal(p_request_id uuid,p_session_id uuid,p_event_id uuid,p_check_id uuid,p_agent_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare e events%rowtype; c checks%rowtype; r heartbeat_rehearsals%rowtype;
begin
  select * into e from events where id=p_event_id for update;
  if not found or e.type<>'crisis' or e.request_id is distinct from p_session_id or
    e.alert_text not like 'SIMULATED DISASTER REPLAY ['||p_session_id::text||']%' then
    raise exception 'Unknown replay session';
  end if;
  select * into r from heartbeat_rehearsals where request_id=p_request_id or event_id=p_event_id;
  if found then
    if r.request_id=p_request_id and r.session_id=p_session_id and r.event_id=p_event_id and r.check_id=p_check_id then
      return jsonb_build_object('duplicate',true,'rehearsal',to_jsonb(r));
    end if;
    raise exception 'This replay already has its one real call reservation';
  end if;
  if e.dispatching or not exists(select 1 from call_logs l join checks k on k.id=l.check_id
    where k.event_id=p_event_id and l.outcome='disaster_demo_step_complete'
      and l.raw->>'sessionId'=p_session_id::text and l.raw->>'step'='5') then
    raise exception 'Complete the sample replay before calling a teammate';
  end if;
  select * into c from checks where id=p_check_id and event_id=p_event_id for update;
  if not found or c.handled_at is not null or c.status='handled' then raise exception 'Select an open case in this replay'; end if;
  insert into heartbeat_rehearsals(request_id,session_id,event_id,check_id,agent_id)
    values(p_request_id,p_session_id,p_event_id,p_check_id,p_agent_id) returning * into r;
  update checks set status='calling',last_call_id=null,ladder_step=0,next_action_at=null,
    priority_assessment=null,priority_call_id=null,priority_turn_count=0,nurse_transfer=null,
    acoustic_assessment=null,summary='Teammate call requested; awaiting provider confirmation.',
    flag_reason=null,urgency=null,sms_status=null,action_token=null,action_started_at=null where id=p_check_id;
  return jsonb_build_object('created',true,'rehearsal',to_jsonb(r));
end;
$$;

create or replace function bind_heartbeat_rehearsal(p_request_id uuid,p_call_id text,p_uncertain boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r heartbeat_rehearsals%rowtype;
begin
  select * into r from heartbeat_rehearsals where request_id=p_request_id for update;
  if not found then raise exception 'Unknown rehearsal reservation'; end if;
  if p_call_id is not null and r.call_id is not null and r.call_id<>p_call_id then raise exception 'Call binding mismatch'; end if;
  if p_uncertain and r.call_id is not null and r.status not in ('reserved','requested') then return to_jsonb(r); end if;
  update heartbeat_rehearsals set call_id=coalesce(call_id,p_call_id),
    status=case when p_uncertain and status in ('reserved','requested') then 'unknown' when status='reserved' then 'requested' else status end,
    updated_at=now() where request_id=p_request_id returning * into r;
  update checks set last_call_id=coalesce(r.call_id,last_call_id),next_action_at=null,
    status=case when p_uncertain then 'needs_human' else status end,
    flag_reason=case when p_uncertain then 'Call request unconfirmed; inspect provider before trying again.' else flag_reason end,
    urgency=case when p_uncertain then 'urgent' else urgency end where id=r.check_id and handled_at is null and status<>'handled';
  return to_jsonb(r);
end;
$$;

create or replace function save_heartbeat_rehearsal_snapshot(p_request_id uuid,p_call_id text,p_event text,
  p_turns jsonb,p_transcript text,p_raw jsonb,p_recording boolean,p_priority jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r heartbeat_rehearsals%rowtype; n integer; final boolean; result jsonb;
begin
  select * into r from heartbeat_rehearsals where request_id=p_request_id for update;
  if not found then raise exception 'Unknown rehearsal'; end if;
  if r.call_id is not null and r.call_id<>p_call_id then raise exception 'Call binding mismatch'; end if;
  if p_event not in ('call_started','transcript_updated','call_ended','call_analyzed') then return jsonb_build_object('ignored',true); end if;
  if r.status='analyzed' then
    update heartbeat_rehearsals set recording_available=recording_available or p_recording,updated_at=now()
      where request_id=p_request_id;
    return jsonb_build_object('duplicate',true);
  end if;
  n:=jsonb_array_length(p_turns); final:=p_event='call_analyzed';
  update heartbeat_rehearsals set call_id=p_call_id,
    status=case when final then 'analyzed' when p_event='call_ended' then 'ended'
      when status='ended' then 'ended' else 'ongoing' end,
    turns=case when n>=turn_count then p_turns else turns end,
    transcript=case when n>=turn_count then p_transcript else transcript end,
    turn_count=greatest(n,turn_count),raw=case when final or status<>'ended' then p_raw else raw end,
    recording_available=recording_available or p_recording,updated_at=now()
    where request_id=p_request_id returning * into r;
  update checks set last_call_id=p_call_id,next_action_at=null where id=r.check_id and handled_at is null and status<>'handled';
  if final then
    result:=apply_heartbeat_result(r.check_id,p_call_id,'client',p_result,r.transcript,p_raw,null);
  elsif p_event='transcript_updated' and p_priority is not null then
    result:=apply_heartbeat_priority(r.check_id,p_call_id,'client',p_priority,n);
  elsif p_event='call_ended' then
    update checks set status='needs_human',urgency='urgent',next_action_at=null,
      summary='Call ended. Waiting for analysis; a person must review the conversation.',
      flag_reason='Call ended; outcome awaiting review.' where id=r.check_id and handled_at is null and status<>'handled';
  end if;
  update checks set next_action_at=null where id=r.check_id;
  return jsonb_build_object('applied',true,'result',result);
end;
$$;
revoke all on function reserve_heartbeat_rehearsal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function bind_heartbeat_rehearsal(uuid,text,boolean) from public,anon,authenticated;
revoke all on function save_heartbeat_rehearsal_snapshot(uuid,text,text,jsonb,text,jsonb,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function reserve_heartbeat_rehearsal(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function bind_heartbeat_rehearsal(uuid,text,boolean) to service_role;
grant execute on function save_heartbeat_rehearsal_snapshot(uuid,text,text,jsonb,text,jsonb,boolean,jsonb,jsonb) to service_role;
