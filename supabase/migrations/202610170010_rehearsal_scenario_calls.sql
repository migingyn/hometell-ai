-- Allow separately requested calls for multiple residents in the same scenario.
-- Preserve each case's evidence, request idempotency, and cross-session dial guard.
begin;

alter table heartbeat_rehearsals drop constraint if exists heartbeat_rehearsals_event_id_key;
create index if not exists heartbeat_rehearsals_event_idx on heartbeat_rehearsals(event_id);

create or replace function reserve_heartbeat_rehearsal(p_request_id uuid,p_session_id uuid,p_event_id uuid,p_check_id uuid,p_agent_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare e events%rowtype; c checks%rowtype; r heartbeat_rehearsals%rowtype;
begin
  perform pg_advisory_xact_lock(128033,171009);
  select * into e from events where id=p_event_id for update;
  if not found or e.type<>'crisis' or e.request_id is distinct from p_session_id or
    e.alert_text not like 'SIMULATED DISASTER REPLAY ['||p_session_id::text||']%' then
    raise exception 'Unknown replay session';
  end if;
  select * into r from heartbeat_rehearsals where request_id=p_request_id;
  if found then
    if r.session_id=p_session_id and r.event_id=p_event_id and r.check_id=p_check_id and r.agent_id=p_agent_id then
      return jsonb_build_object('duplicate',true,'rehearsal',to_jsonb(r));
    end if;
    raise exception 'This request already belongs to another call reservation';
  end if;
  if e.dispatching or not exists(select 1 from call_logs l join checks k on k.id=l.check_id
    where k.event_id=p_event_id and l.outcome='disaster_demo_step_complete'
      and l.raw->>'sessionId'=p_session_id::text and l.raw->>'step'='5') then
    raise exception 'Complete the sample replay before calling a teammate';
  end if;
  select * into c from checks where id=p_check_id and event_id=p_event_id for update;
  if not found or c.handled_at is not null or c.status='handled' then raise exception 'Select an open case in this replay'; end if;

  -- These protect actual concurrent/uncertain calls; they are not a scenario quota.
  if exists(select 1 from heartbeat_rehearsals where status in ('unknown','error')) then
    raise exception 'REHEARSAL_CALL_UNCERTAIN';
  end if;
  if exists(select 1 from heartbeat_rehearsals where status in ('reserved','requested','ongoing')) then
    raise exception 'REHEARSAL_CALL_ACTIVE';
  end if;
  if exists(select 1 from heartbeat_rehearsals where status in ('ended','analyzed')
    and coalesce(call_finished_at,updated_at)>clock_timestamp()-interval '60 seconds') then
    raise exception 'REHEARSAL_CALL_COOLDOWN';
  end if;

  insert into heartbeat_rehearsals(request_id,session_id,event_id,check_id,agent_id)
    values(p_request_id,p_session_id,p_event_id,p_check_id,p_agent_id) returning * into r;
  update checks set status='calling',last_call_id=null,ladder_step=0,next_action_at=null,
    priority_assessment=null,priority_call_id=null,priority_turn_count=0,nurse_transfer=null,
    acoustic_assessment=null,summary='Teammate call requested; awaiting provider confirmation.',
    flag_reason=null,urgency=null,sms_status=null,action_token=null,action_started_at=null where id=p_check_id;
  return jsonb_build_object('created',true,'rehearsal',to_jsonb(r));
end;
$$;

revoke all on function reserve_heartbeat_rehearsal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function reserve_heartbeat_rehearsal(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
