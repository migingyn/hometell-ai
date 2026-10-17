-- Additive migration: never deletes enrolled clients, events, or call history.
alter table events add column if not exists alert_text text;
alter table clients add column if not exists language text not null default 'en';
alter table clients add column if not exists needs_ride boolean not null default false;
alter table clients add column if not exists last_daily_at timestamptz;
alter table clients add column if not exists lat double precision;
alter table clients add column if not exists lng double precision;
alter table checks add column if not exists urgency text check (urgency in ('urgent', 'follow_up'));
alter table checks add column if not exists sms_status text;
alter table checks add column if not exists action_token uuid;
alter table checks add column if not exists action_started_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='events') then
    alter publication supabase_realtime add table events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='clients') then
    alter publication supabase_realtime add table clients;
  end if;
end $$;

-- The result and its unique call log commit together. A handled card or newer
-- attempt wins even if the webhook was already being classified in another request.
create or replace function apply_heartbeat_result(
  p_check_id uuid, p_call_id text, p_target text, p_result jsonb,
  p_transcript text, p_raw jsonb, p_next_action_at timestamptz
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_check checks%rowtype; prior_status text;
begin
  select * into current_check from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if current_check.status='handled' then return jsonb_build_object('skipped','handled'); end if;
  if current_check.last_call_id is distinct from p_call_id then return jsonb_build_object('skipped','stale_call'); end if;
  if exists(select 1 from call_logs where retell_call_id=p_call_id) then return jsonb_build_object('duplicate',true); end if;
  if p_target is distinct from (case when current_check.ladder_step=3 then 'emergency_contact' else 'client' end) then
    return jsonb_build_object('skipped','wrong_target');
  end if;
  prior_status := current_check.status;
  insert into call_logs(check_id,retell_call_id,target,outcome,transcript,raw)
    values(p_check_id,p_call_id,p_target,p_result->>'status',p_transcript,p_raw);
  update checks set
    status=p_result->>'status', summary=p_result->>'summary',
    flag_reason=p_result->>'flag_reason', urgency=p_result->>'urgency',
    next_action_at=p_next_action_at, action_token=null, action_started_at=null
    where id=p_check_id returning * into current_check;
  return jsonb_build_object('applied',true,'prior_status',prior_status,'check',to_jsonb(current_check));
end;
$$;
revoke all on function apply_heartbeat_result(uuid,text,text,jsonb,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function apply_heartbeat_result(uuid,text,text,jsonb,text,jsonb,timestamptz) to service_role;
