-- Two clicks/tabs must not start two daily calls for the same resident.
create function start_care_daily_call(p_client_id uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare active_check checks%rowtype; new_event events%rowtype; membership care_profiles%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_client_id::text, 170009));
 select * into membership from care_profiles where client_id=p_client_id;
 if not found then return jsonb_build_object('skipped','unknown'); end if;
 select * into active_check from checks where client_id=p_client_id and status in ('queued','calling') limit 1;
 if found then return jsonb_build_object('skipped','active'); end if;
 insert into events(type,facility_id,request_id) values('daily',membership.facility_id,gen_random_uuid()) returning * into new_event;
 insert into checks(client_id,event_id,status) values(p_client_id,new_event.id,'queued') returning * into active_check;
 return jsonb_build_object('check',to_jsonb(active_check));
end $$;
revoke all on function start_care_daily_call(uuid) from public,anon,authenticated;
grant execute on function start_care_daily_call(uuid) to service_role;
