-- Patient-reported post-operative evidence and human review, never treatment or dispatch.
alter table checks add column if not exists postop_assessment jsonb;
alter table checks add column if not exists nurse_transfer jsonb;

-- Keep the existing atomic outcome/log write and its stale, duplicate, handled,
-- target and priority protections. Store post-operative evidence in that same transaction.
create or replace function apply_heartbeat_result(
  p_check_id uuid, p_call_id text, p_target text, p_result jsonb,
  p_transcript text, p_raw jsonb, p_next_action_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  current_check checks%rowtype; prior_status text; assessment jsonb; protect boolean;
  postop jsonb; transfer_open boolean;
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
  transfer_open := current_check.nurse_transfer->>'call_id'=p_call_id and
    current_check.nurse_transfer->>'status' in ('started','connected','failed','ended_unconfirmed');
  postop := nullif(p_result->'postop_assessment','null'::jsonb);
  if postop is not null and (p_target<>'client' or
      not exists(select 1 from events where id=current_check.event_id and type='daily') or
      postop->>'version' is distinct from '1' or postop->>'call_id' is distinct from p_call_id or
      jsonb_typeof(postop->'answers') is distinct from 'object' or
      postop->'suggested_next_step'->>'status' is distinct from 'proposed' or
      postop->'suggested_next_step'->>'action' is distinct from 'nurse_review') then
    raise exception 'Invalid post-operative assessment';
  end if;
  insert into call_logs(check_id,retell_call_id,target,outcome,transcript,raw)
    values(p_check_id,p_call_id,p_target,case when protect or transfer_open then 'needs_human' else p_result->>'status' end,p_transcript,p_raw);
  update checks set
    status=case when protect or transfer_open then 'needs_human' else p_result->>'status' end,
    summary=p_result->>'summary',
    flag_reason=case when protect or transfer_open then coalesce(current_check.flag_reason,p_result->>'flag_reason',assessment->'reasons'->>0) else p_result->>'flag_reason' end,
    urgency=case when protect then 'urgent' when transfer_open then coalesce(current_check.urgency,'follow_up') else p_result->>'urgency' end,
    priority_assessment=assessment,
    priority_call_id=case when assessment is not null then p_call_id else priority_call_id end,
    postop_assessment=coalesce(postop,current_check.postop_assessment),
    next_action_at=case when protect or transfer_open then null else p_next_action_at end,
    action_token=null, action_started_at=null
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'prior_status',prior_status,'check',to_jsonb(current_check));
end;
$$;
revoke all on function apply_heartbeat_result(uuid,text,text,jsonb,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function apply_heartbeat_result(uuid,text,text,jsonb,text,jsonb,timestamptz) to service_role;

create or replace function approve_heartbeat_postop_review(p_check_id uuid,p_call_id text,p_reviewer text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_check checks%rowtype; recommendation jsonb;
begin
  select * into current_check from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if current_check.status='handled' or current_check.handled_at is not null then return jsonb_build_object('skipped','handled'); end if;
  if not exists(select 1 from events where id=current_check.event_id and type='daily') then return jsonb_build_object('skipped','not_daily'); end if;
  if current_check.last_call_id is distinct from p_call_id or current_check.postop_assessment->>'call_id' is distinct from p_call_id then
    return jsonb_build_object('skipped','stale_call');
  end if;
  if p_reviewer is null or length(trim(p_reviewer)) not between 1 and 100 then raise exception 'Reviewer required'; end if;
  recommendation := current_check.postop_assessment->'suggested_next_step';
  if recommendation->>'status'='approved' then return jsonb_build_object('duplicate',true,'check',to_jsonb(current_check)); end if;
  if recommendation->>'status' is distinct from 'proposed' or recommendation->>'action' is distinct from 'nurse_review' then
    return jsonb_build_object('skipped','no_proposal');
  end if;
  update checks set postop_assessment=jsonb_set(postop_assessment,'{suggested_next_step}',
    recommendation || jsonb_build_object('status','approved','approved_at',now(),'reviewer',trim(p_reviewer)))
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'check',to_jsonb(current_check));
end;
$$;
revoke all on function approve_heartbeat_postop_review(uuid,text,text) from public, anon, authenticated;
grant execute on function approve_heartbeat_postop_review(uuid,text,text) to service_role;

-- Provider transfer events may be duplicated or delivered out of order. A
-- transfer_ended event alone never proves connection or resolves the check.
create or replace function apply_heartbeat_transfer(p_check_id uuid,p_call_id text,p_event text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_check checks%rowtype; prior_transfer text; next_transfer text; event_mode text;
begin
  select * into current_check from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if current_check.status='handled' or current_check.handled_at is not null then return jsonb_build_object('skipped','handled'); end if;
  if current_check.last_call_id is distinct from p_call_id then return jsonb_build_object('skipped','stale_call'); end if;
  select type into event_mode from events where id=current_check.event_id;
  if p_event not in ('transfer_started','transfer_bridged','transfer_cancelled','transfer_ended') then raise exception 'Invalid transfer event'; end if;
  prior_transfer := case when current_check.nurse_transfer->>'call_id'=p_call_id then current_check.nurse_transfer->>'status' else null end;
  next_transfer := case
    when prior_transfer='connected' or p_event='transfer_bridged' then 'connected'
    when prior_transfer='failed' or p_event='transfer_cancelled' then 'failed'
    when prior_transfer='ended_unconfirmed' or p_event='transfer_ended' then 'ended_unconfirmed'
    else 'started' end;
  if next_transfer is not distinct from prior_transfer then return jsonb_build_object('duplicate',true,'check',to_jsonb(current_check)); end if;
  update checks set
    nurse_transfer=jsonb_build_object('call_id',p_call_id,'status',next_transfer,'updated_at',now()),
    status='needs_human',urgency=case when event_mode='daily' then coalesce(urgency,'follow_up') else 'urgent' end,next_action_at=null,
    flag_reason=case when urgency='urgent' then flag_reason else
      case next_transfer when 'connected' then 'Call connected to a person; nurse follow-up remains open.'
        when 'failed' then 'Nurse transfer failed; follow up with the patient.'
        when 'ended_unconfirmed' then 'Nurse transfer ended without confirmed connection; follow up with the patient.'
        else 'Nurse transfer requested; connection is not confirmed.' end end
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'check',to_jsonb(current_check));
end;
$$;
revoke all on function apply_heartbeat_transfer(uuid,text,text) from public, anon, authenticated;
grant execute on function apply_heartbeat_transfer(uuid,text,text) to service_role;
