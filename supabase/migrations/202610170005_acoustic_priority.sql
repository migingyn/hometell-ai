-- Store expression-model evidence separately from the caller's reported words.
alter table checks add column if not exists acoustic_assessment jsonb;

create or replace function apply_heartbeat_acoustic(
  p_check_id uuid, p_call_id text, p_target text, p_acoustic jsonb, p_priority jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  current_check checks%rowtype;
  assessment jsonb;
  prior_rank integer;
  next_rank integer;
  available boolean;
  elevated boolean;
  prior_status text;
begin
  select * into current_check from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if current_check.status='handled' or current_check.handled_at is not null then return jsonb_build_object('skipped','handled'); end if;
  if current_check.last_call_id is distinct from p_call_id then return jsonb_build_object('skipped','stale_call'); end if;
  if p_target is distinct from (case when current_check.ladder_step=3 then 'emergency_contact' else 'client' end) then
    return jsonb_build_object('skipped','wrong_target');
  end if;
  if p_acoustic->>'call_id' is distinct from p_call_id or
    p_acoustic->'result'->>'version' is distinct from '1' or
    coalesce(p_acoustic->'result'->>'status','') not in ('available','insufficient_audio','unavailable') or
    coalesce(p_acoustic->'result'->>'signal','') not in ('elevated','uncertain') or
    coalesce(heartbeat_priority_rank(p_priority->>'priority'),0)=0 or
    jsonb_typeof(p_priority->'reasons') is distinct from 'array' then
    raise exception 'Invalid acoustic priority assessment';
  end if;

  available := p_acoustic->'result'->>'status'='available';
  elevated := available and p_acoustic->'result'->>'signal'='elevated';
  if current_check.acoustic_assessment->>'call_id'=p_call_id and
    current_check.acoustic_assessment->'result'->>'status'='available' and not available then
    return jsonb_build_object('skipped','available_result_retained');
  end if;
  if current_check.acoustic_assessment->>'call_id'=p_call_id and
    current_check.acoustic_assessment->'result'->>'status'='available' and
    current_check.acoustic_assessment->'result'->>'signal'='elevated' and
    available and p_acoustic->'result'->>'signal'='uncertain' then
    return jsonb_build_object('skipped','elevated_result_retained');
  end if;

  prior_status := current_check.status;
  prior_rank := greatest(heartbeat_priority_rank(current_check.priority_assessment->>'priority'),
    case when current_check.status='needs_human' and current_check.urgency='urgent' then 3 else 0 end);
  assessment := p_priority;
  next_rank := heartbeat_priority_rank(assessment->>'priority');
  if prior_rank>next_rank then
    assessment := coalesce(current_check.priority_assessment,assessment);
    if heartbeat_priority_rank(assessment->>'priority')<prior_rank then
      assessment := jsonb_set(assessment,'{priority}',to_jsonb(case when prior_rank=4 then 'immediate'::text else 'urgent'::text end));
    end if;
  end if;
  -- Audio metadata reflects this analysis even when a higher earlier concern is
  -- retained under the row lock. Text evidence and situation remain untouched.
  if available then
    assessment := jsonb_set(assessment,'{audible_distress}',p_acoustic->'result'->'signal');
    assessment := jsonb_set(assessment,'{reasons}',(
      select coalesce(jsonb_agg(reason order by reason),'[]'::jsonb) from (
        select value as reason
          from jsonb_array_elements_text(coalesce(assessment->'reasons','[]'::jsonb))
          where value not like 'Acoustic expression:%' and value not like 'Audible distress is unavailable:%'
        union
        select value as reason
          from jsonb_array_elements_text(p_priority->'reasons')
          where value like 'Acoustic expression:%'
      ) merged_reasons
    ));
  end if;
  next_rank := heartbeat_priority_rank(assessment->>'priority');

  -- A retry with a different processing timestamp is still the same evidence.
  if current_check.acoustic_assessment->>'call_id'=p_call_id and
    current_check.acoustic_assessment->>'source'=p_acoustic->>'source' and
    current_check.acoustic_assessment->'result'=p_acoustic->'result' and
    current_check.priority_assessment=assessment then
    return jsonb_build_object('duplicate',true);
  end if;
  update checks set
    acoustic_assessment=p_acoustic,
    priority_assessment=assessment,
    priority_call_id=p_call_id,
    status=case when elevated then 'needs_human' else status end,
    urgency=case when urgency='urgent' then urgency when elevated then
      case when next_rank>=3 then 'urgent' else 'follow_up' end else urgency end,
    flag_reason=case when elevated and coalesce(flag_reason,'')='' then 'Acoustic expression signal requires operator review' else flag_reason end,
    next_action_at=case when elevated then null else next_action_at end
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'check',to_jsonb(current_check),
    'newly_escalated',elevated and (prior_status<>'needs_human' or next_rank>prior_rank));
end;
$$;
revoke all on function apply_heartbeat_acoustic(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function apply_heartbeat_acoustic(uuid,text,text,jsonb,jsonb) to service_role;
