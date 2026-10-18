-- A bounded, leased recording job for the single explicitly reserved teammate call.
-- It stays separate from MOCK_RETELL so sample-roster calls remain simulated.
alter table heartbeat_rehearsals
  add column if not exists acoustic_status text not null default 'waiting_for_call'
    check(acoustic_status in ('waiting_for_call','waiting_for_recording','processing','available','insufficient_audio','unavailable')),
  add column if not exists acoustic_signal text check(acoustic_signal in ('elevated','uncertain')),
  add column if not exists acoustic_updated_at timestamptz,
  add column if not exists acoustic_attempts integer not null default 0,
  add column if not exists acoustic_retry_at timestamptz,
  add column if not exists acoustic_lease_token uuid,
  add column if not exists acoustic_lease_until timestamptz;

create or replace function claim_heartbeat_rehearsal_acoustic(p_request_id uuid,p_call_id text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r heartbeat_rehearsals%rowtype; c checks%rowtype;
begin
  select * into r from heartbeat_rehearsals where request_id=p_request_id for update;
  if not found or p_call_id is null or p_token is null or r.call_id is distinct from p_call_id or p_call_id like 'mock_%' or r.status<>'analyzed' then
    return jsonb_build_object('skipped','unbound_or_unfinished');
  end if;
  if r.acoustic_status in ('available','insufficient_audio','unavailable') then return jsonb_build_object('skipped','complete'); end if;
  select * into c from checks where id=r.check_id for update;
  if not found or c.last_call_id is distinct from p_call_id or c.status='handled' or c.handled_at is not null then
    update heartbeat_rehearsals set acoustic_status='unavailable',acoustic_signal=null,acoustic_updated_at=now(),
      acoustic_retry_at=null,acoustic_lease_token=null,acoustic_lease_until=null where request_id=p_request_id;
    return jsonb_build_object('skipped','stale_or_handled');
  end if;
  if r.acoustic_status='processing' and r.acoustic_lease_until>now() then return jsonb_build_object('skipped','leased'); end if;
  if r.acoustic_retry_at>now() then return jsonb_build_object('skipped','retry_later'); end if;
  if r.acoustic_attempts>=3 then
    update heartbeat_rehearsals set acoustic_status='unavailable',acoustic_signal=null,
      acoustic_updated_at=now(),acoustic_retry_at=null,acoustic_lease_token=null,acoustic_lease_until=null
      where request_id=p_request_id;
    return jsonb_build_object('skipped','attempts_exhausted');
  end if;
  update heartbeat_rehearsals set acoustic_status='processing',acoustic_signal=null,acoustic_updated_at=now(),
    acoustic_attempts=acoustic_attempts+1,acoustic_retry_at=null,acoustic_lease_token=p_token,
    acoustic_lease_until=now()+interval '4 minutes' where request_id=p_request_id returning * into r;
  return jsonb_build_object('claimed',true,'rehearsal',to_jsonb(r));
end;
$$;

-- Keep late, verified recording links without replacing finalized words or outcome.
create or replace function merge_heartbeat_rehearsal_recording(p_request_id uuid,p_call_id text,p_call jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  update heartbeat_rehearsals set raw=jsonb_set(coalesce(raw,'{}'::jsonb),'{call}',
    coalesce(raw->'call','{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'recording_url',p_call->'recording_url','recording_multi_channel_url',p_call->'recording_multi_channel_url')))
    where request_id=p_request_id and call_id=p_call_id and status='analyzed'
      and p_call->>'call_id'=call_id and p_call->>'agent_id'=agent_id
      and p_call->'metadata'->>'rehearsal_request_id'=request_id::text
      and p_call->'metadata'->>'check_id'=check_id::text and p_call->'metadata'->>'target'='client';
end;
$$;

create or replace function finish_heartbeat_rehearsal_acoustic(p_request_id uuid,p_call_id text,p_token uuid,
  p_acoustic jsonb,p_priority jsonb,p_retry boolean)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r heartbeat_rehearsals%rowtype; c checks%rowtype; result jsonb; outcome text;
begin
  select * into r from heartbeat_rehearsals where request_id=p_request_id for update;
  if not found or r.call_id is distinct from p_call_id or r.acoustic_lease_token is distinct from p_token or r.acoustic_status<>'processing' then
    return jsonb_build_object('skipped','stale_lease');
  end if;
  select * into c from checks where id=r.check_id for update;
  if not found or c.last_call_id is distinct from p_call_id or c.status='handled' or c.handled_at is not null then
    update heartbeat_rehearsals set acoustic_status='unavailable',acoustic_signal=null,acoustic_updated_at=now(),
      acoustic_retry_at=null,acoustic_lease_token=null,acoustic_lease_until=null where request_id=p_request_id;
    return jsonb_build_object('skipped','stale_or_handled');
  end if;
  if p_retry and r.acoustic_attempts<3 then
    update heartbeat_rehearsals set acoustic_status='waiting_for_recording',acoustic_signal=null,
      acoustic_updated_at=now(),acoustic_retry_at=now()+make_interval(secs=>10*r.acoustic_attempts),
      acoustic_lease_token=null,acoustic_lease_until=null where request_id=p_request_id;
    return jsonb_build_object('retry',true);
  end if;
  result:=apply_heartbeat_acoustic(r.check_id,p_call_id,'client',p_acoustic,p_priority);
  -- Derive public state from the assessment actually retained by the check RPC.
  select * into c from checks where id=r.check_id;
  outcome:=case when c.acoustic_assessment->>'call_id'=p_call_id then c.acoustic_assessment->'result'->>'status' else 'unavailable' end;
  update heartbeat_rehearsals set acoustic_status=outcome,
    acoustic_signal=case when outcome='available' then c.acoustic_assessment->'result'->>'signal' else null end,
    acoustic_updated_at=now(),acoustic_retry_at=null,acoustic_lease_token=null,acoustic_lease_until=null
    where request_id=p_request_id;
  return jsonb_build_object('finished',true,'result',result);
end;
$$;
revoke all on function claim_heartbeat_rehearsal_acoustic(uuid,text,uuid) from public,anon,authenticated;
revoke all on function finish_heartbeat_rehearsal_acoustic(uuid,text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function merge_heartbeat_rehearsal_recording(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function claim_heartbeat_rehearsal_acoustic(uuid,text,uuid) to service_role;
grant execute on function finish_heartbeat_rehearsal_acoustic(uuid,text,uuid,jsonb,jsonb,boolean) to service_role;
grant execute on function merge_heartbeat_rehearsal_recording(uuid,text,jsonb) to service_role;
