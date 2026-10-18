-- Additive operator decision support. No dispatch or medical eligibility decisions.
alter table checks add column if not exists priority_assessment jsonb;
alter table checks add column if not exists priority_call_id text;
alter table checks add column if not exists priority_turn_count integer not null default 0;

create or replace function heartbeat_priority_rank(priority text)
returns integer language sql immutable as $$
  select case priority when 'immediate' then 4 when 'urgent' then 3 when 'review' then 2 when 'follow_up' then 1 else 0 end
$$;
revoke all on function heartbeat_priority_rank(text) from public, anon, authenticated;
grant execute on function heartbeat_priority_rank(text) to service_role;

-- Live snapshots can repeat or arrive out of order. Unlike final call logs,
-- these are not deduplicated just by call_id. High concerns remain until handled.
create or replace function apply_heartbeat_priority(
  p_check_id uuid, p_call_id text, p_target text, p_assessment jsonb, p_turn_count integer
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_check checks%rowtype; prior_status text; prior_rank integer; next_rank integer; escalate boolean;
begin
  select * into current_check from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if current_check.status='handled' or current_check.handled_at is not null then return jsonb_build_object('skipped','handled'); end if;
  if current_check.last_call_id is distinct from p_call_id then return jsonb_build_object('skipped','stale_call'); end if;
  if p_target is distinct from (case when current_check.ladder_step=3 then 'emergency_contact' else 'client' end) then
    return jsonb_build_object('skipped','wrong_target');
  end if;
  if exists(select 1 from call_logs where retell_call_id=p_call_id) then return jsonb_build_object('skipped','already_analyzed'); end if;
  if p_turn_count < 0 or p_assessment->>'stage' is distinct from 'live' or
    p_assessment->>'audible_distress' is distinct from 'unavailable' or
    coalesce(heartbeat_priority_rank(p_assessment->>'priority'),0)=0 then
    raise exception 'Invalid caller priority snapshot';
  end if;
  if current_check.priority_call_id=p_call_id then
    if p_turn_count < current_check.priority_turn_count then return jsonb_build_object('skipped','older_snapshot'); end if;
    if p_turn_count = current_check.priority_turn_count and p_assessment=current_check.priority_assessment then return jsonb_build_object('duplicate',true); end if;
  end if;
  prior_rank := heartbeat_priority_rank(current_check.priority_assessment->>'priority');
  next_rank := heartbeat_priority_rank(p_assessment->>'priority');
  if prior_rank >= 3 and prior_rank > next_rank then return jsonb_build_object('skipped','protected_priority'); end if;
  prior_status := current_check.status;
  escalate := next_rank >= 3;
  update checks set
    priority_assessment=p_assessment, priority_call_id=p_call_id, priority_turn_count=p_turn_count,
    status=case when escalate then 'needs_human' else status end,
    urgency=case when escalate then 'urgent' else urgency end,
    flag_reason=case when escalate and coalesce(flag_reason,'') not like 'said "%' then
      'Priority review: ' || coalesce(p_assessment->'reasons'->>0,'Caller report needs a person') else flag_reason end,
    next_action_at=case when escalate then null else next_action_at end
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'check',to_jsonb(current_check),
    'newly_escalated',escalate and (prior_status<>'needs_human' or next_rank>prior_rank));
end;
$$;
revoke all on function apply_heartbeat_priority(uuid,text,text,jsonb,integer) from public, anon, authenticated;
grant execute on function apply_heartbeat_priority(uuid,text,text,jsonb,integer) to service_role;

-- Final outcome and private log still commit together, with live priority retained.
create or replace function apply_heartbeat_result(
  p_check_id uuid, p_call_id text, p_target text, p_result jsonb,
  p_transcript text, p_raw jsonb, p_next_action_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_check checks%rowtype; prior_status text; assessment jsonb; protect boolean;
begin
  select * into current_check from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if current_check.status='handled' or current_check.handled_at is not null then return jsonb_build_object('skipped','handled'); end if;
  if current_check.last_call_id is distinct from p_call_id then return jsonb_build_object('skipped','stale_call'); end if;
  if exists(select 1 from call_logs where retell_call_id=p_call_id) then return jsonb_build_object('duplicate',true); end if;
  if p_target is distinct from (case when current_check.ladder_step=3 then 'emergency_contact' else 'client' end) then
    return jsonb_build_object('skipped','wrong_target');
  end if;
  prior_status := current_check.status;
  assessment := nullif(p_result->'priority_assessment','null'::jsonb);
  if heartbeat_priority_rank(current_check.priority_assessment->>'priority') >= 3 and
    heartbeat_priority_rank(current_check.priority_assessment->>'priority') > heartbeat_priority_rank(assessment->>'priority') then
    assessment := current_check.priority_assessment;
  end if;
  protect := heartbeat_priority_rank(assessment->>'priority') >= 3 or
    (current_check.status='needs_human' and current_check.urgency='urgent' and current_check.flag_reason like 'said "%');
  insert into call_logs(check_id,retell_call_id,target,outcome,transcript,raw)
    values(p_check_id,p_call_id,p_target,case when protect then 'needs_human' else p_result->>'status' end,p_transcript,p_raw);
  update checks set
    status=case when protect then 'needs_human' else p_result->>'status' end,
    summary=p_result->>'summary',
    flag_reason=case when protect then coalesce(current_check.flag_reason,p_result->>'flag_reason',assessment->'reasons'->>0) else p_result->>'flag_reason' end,
    urgency=case when protect then 'urgent' else p_result->>'urgency' end,
    priority_assessment=assessment,
    priority_call_id=case when assessment is not null then p_call_id else priority_call_id end,
    next_action_at=case when protect then null else p_next_action_at end,
    action_token=null, action_started_at=null
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'prior_status',prior_status,'check',to_jsonb(current_check));
end;
$$;
revoke all on function apply_heartbeat_result(uuid,text,text,jsonb,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function apply_heartbeat_result(uuid,text,text,jsonb,text,jsonb,timestamptz) to service_role;
