alter table events add column if not exists request_id uuid unique;
alter table events add column if not exists dispatching boolean not null default false;

create or replace function start_heartbeat_event(p_type text, p_alert text, p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_event events%rowtype;
begin
  perform pg_advisory_xact_lock(172026, 1);
  if p_request_id is not null then
    select * into current_event from events where request_id=p_request_id;
    if found then return jsonb_build_object('duplicate',true,'event',to_jsonb(current_event)); end if;
  else
    select * into current_event from events where type=p_type and alert_text is not distinct from p_alert
      and started_at > now()-interval '30 seconds' order by started_at desc limit 1;
    if found then return jsonb_build_object('duplicate',true,'event',to_jsonb(current_event)); end if;
  end if;
  if exists(select 1 from events where dispatching and started_at > now()-interval '6 minutes') then
    return jsonb_build_object('busy',true);
  end if;
  insert into events(type,alert_text,request_id,dispatching) values(p_type,p_alert,p_request_id,true) returning * into current_event;
  return jsonb_build_object('event',to_jsonb(current_event));
end $$;
revoke all on function start_heartbeat_event(text,text,uuid) from public, anon, authenticated;
grant execute on function start_heartbeat_event(text,text,uuid) to service_role;

-- Presenters can read fictional identities and planning fields, but not private
-- teammate/client telephone numbers. Only the server can read the base roster.
drop policy if exists "anon read clients" on clients;
create or replace view clients_public as select
  id,name,risk_tier,lives_alone,uses_powered_equipment,emergency_contact_name,
  usual_pickup_time,language,needs_ride,last_daily_at,lat,lng from clients;
grant select on clients_public to anon, authenticated;
