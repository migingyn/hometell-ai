-- This local presentation has one live participant, even across replay sessions.
-- Serialize reservations before the event lock; never expire an uncertain call.
begin;

alter table heartbeat_rehearsals add column if not exists call_finished_at timestamptz;

-- Preserve existing terminal evidence; later recording/acoustic writes must not
-- restart the cooldown. No existing call status or evidence is changed.
update heartbeat_rehearsals set call_finished_at=updated_at
  where status in ('ended','analyzed') and call_finished_at is null;

create or replace function stamp_heartbeat_rehearsal_finished()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.status in ('ended','analyzed') then
    if tg_op='UPDATE' then
      new.call_finished_at:=coalesce(old.call_finished_at,new.call_finished_at,clock_timestamp());
    else
      new.call_finished_at:=coalesce(new.call_finished_at,clock_timestamp());
    end if;
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='heartbeat_rehearsal_finished_stamp'
    and tgrelid='public.heartbeat_rehearsals'::regclass) then
    create trigger heartbeat_rehearsal_finished_stamp before insert or update of status
      on heartbeat_rehearsals for each row execute function stamp_heartbeat_rehearsal_finished();
  end if;
end $$;

create or replace function reserve_heartbeat_rehearsal(p_request_id uuid,p_session_id uuid,p_event_id uuid,p_check_id uuid,p_agent_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare e events%rowtype; c checks%rowtype; r heartbeat_rehearsals%rowtype;
begin
  -- One shared transaction lock for every session, browser, and presenter.
  -- The reservation row is committed before any provider request is attempted.
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
  if exists(select 1 from heartbeat_rehearsals where event_id=p_event_id) then
    raise exception 'This replay already has its one real call reservation';
  end if;
  if e.dispatching or not exists(select 1 from call_logs l join checks k on k.id=l.check_id
    where k.event_id=p_event_id and l.outcome='disaster_demo_step_complete'
      and l.raw->>'sessionId'=p_session_id::text and l.raw->>'step'='5') then
    raise exception 'Complete the sample replay before calling a teammate';
  end if;
  select * into c from checks where id=p_check_id and event_id=p_event_id for update;
  if not found or c.handled_at is not null or c.status='handled' then raise exception 'Select an open case in this replay'; end if;

  -- Unknown/error attempts stay blocked regardless of age. Resolve their actual
  -- provider outcome before another call; there is no automatic lease expiry.
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

revoke all on function stamp_heartbeat_rehearsal_finished() from public,anon,authenticated;
revoke all on function reserve_heartbeat_rehearsal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function stamp_heartbeat_rehearsal_finished() to service_role;
grant execute on function reserve_heartbeat_rehearsal(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
