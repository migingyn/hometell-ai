-- Append-only operator reviews. Original extractions and patient words stay unchanged.
create table if not exists heartbeat_answer_reviews (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references checks(id) on delete cascade,
  call_id text not null check(length(call_id) between 1 and 200),
  field text not null check(field in ('pain','incision','fever','breathing','appetite','weight','medications','falls')),
  action text not null check(action in ('confirm','correct')),
  original_answer jsonb not null check(jsonb_typeof(original_answer)='object'),
  source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{32}$'),
  corrected_value jsonb,
  reviewer text not null check(length(trim(reviewer)) between 1 and 100),
  reviewed_at timestamptz not null default now(),
  revision integer not null check(revision>0),
  unique(check_id,call_id,field,revision)
);
alter table heartbeat_answer_reviews enable row level security;
revoke all on heartbeat_answer_reviews from public,anon,authenticated,service_role;
grant select,insert on heartbeat_answer_reviews to service_role;

create or replace function read_heartbeat_answer_reviews(p_check_id uuid,p_call_id text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c checks%rowtype; answer jsonb; sources jsonb:='{}'::jsonb; reviews jsonb; field_name text;
begin
  select * into c from checks where id=p_check_id for share;
  if not found then return jsonb_build_object('error_kind','unknown_check'); end if;
  if c.last_call_id is distinct from p_call_id then
    if exists(select 1 from call_logs where check_id=p_check_id and retell_call_id=p_call_id) or
      exists(select 1 from heartbeat_answer_reviews where check_id=p_check_id and call_id=p_call_id) then
      return jsonb_build_object('error_kind','stale_call');
    end if;
    return jsonb_build_object('error_kind','unknown_call');
  end if;
  if c.postop_assessment->>'version' is distinct from '1' or c.postop_assessment->>'call_id' is distinct from p_call_id then
    return jsonb_build_object('error_kind','no_assessment');
  end if;
  foreach field_name in array array['pain','incision','fever','breathing','appetite','weight','medications','falls'] loop
    answer:=c.postop_assessment->'answers'->field_name;
    if answer is null or jsonb_typeof(answer) is distinct from 'object' then return jsonb_build_object('error_kind','no_assessment'); end if;
    sources:=sources || jsonb_build_object(field_name,jsonb_build_object('fingerprint',md5(answer::text),'answer',answer));
  end loop;
  select coalesce(jsonb_agg(to_jsonb(latest)||jsonb_build_object('source_current',
    latest.source_fingerprint=md5((c.postop_assessment->'answers'->latest.field)::text)) order by latest.field),'[]'::jsonb)
    into reviews from (select distinct on (field) * from heartbeat_answer_reviews
      where check_id=p_check_id and call_id=p_call_id order by field,revision desc) latest;
  return jsonb_build_object('checkId',p_check_id,'callId',p_call_id,'reviews',reviews,'sources',sources);
end;
$$;

create or replace function save_heartbeat_answer_review(p_check_id uuid,p_call_id text,p_field text,
  p_action text,p_reviewer text,p_expected_revision integer,p_expected_source text,p_corrected_value jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c checks%rowtype; state jsonb; answer jsonb; fingerprint text; latest_revision integer; review heartbeat_answer_reviews%rowtype;
begin
  -- Serialize answer edits with call outcomes and other reviewers before comparing their snapshots.
  select * into c from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('error_kind','unknown_check'); end if;
  state:=read_heartbeat_answer_reviews(p_check_id,p_call_id);
  if state ? 'error_kind' then return state; end if;
  if c.status='handled' or c.handled_at is not null then return jsonb_build_object('error_kind','handled'); end if;
  if p_field is null or p_field not in ('pain','incision','fever','breathing','appetite','weight','medications','falls') or
    p_action is null or p_action not in ('confirm','correct') or p_reviewer is null or
    length(trim(p_reviewer)) not between 1 and 100 or p_expected_revision is null or
    p_expected_revision not between 0 and 1000000 or p_expected_source is null or
    p_expected_source !~ '^[a-f0-9]{32}$' then return jsonb_build_object('error_kind','invalid'); end if;
  answer:=c.postop_assessment->'answers'->p_field;
  fingerprint:=md5(answer::text);
  if fingerprint is distinct from p_expected_source then return jsonb_build_object('error_kind','source_changed'); end if;
  select coalesce(max(revision),0) into latest_revision from heartbeat_answer_reviews
    where check_id=p_check_id and call_id=p_call_id and field=p_field;
  if latest_revision<>p_expected_revision then return jsonb_build_object('error_kind','revision_conflict'); end if;
  if p_action='confirm' then
    if answer->>'status' is distinct from 'reported' or answer->'value' is null or answer->'value'='null'::jsonb then
      return jsonb_build_object('error_kind','unknown_answer');
    end if;
    if p_corrected_value is not null and p_corrected_value<>'null'::jsonb then return jsonb_build_object('error_kind','invalid'); end if;
  elsif p_corrected_value is not null and p_corrected_value<>'null'::jsonb then
    if p_field='pain' then
      if jsonb_typeof(p_corrected_value) is distinct from 'number' then return jsonb_build_object('error_kind','invalid'); end if;
      if (p_corrected_value#>>'{}')::numeric not between 0 and 10 then return jsonb_build_object('error_kind','invalid'); end if;
    elsif jsonb_typeof(p_corrected_value) is distinct from 'string' or
      length(trim(p_corrected_value#>>'{}')) not between 1 and 2000 then return jsonb_build_object('error_kind','invalid'); end if;
  end if;
  insert into heartbeat_answer_reviews(check_id,call_id,field,action,original_answer,source_fingerprint,corrected_value,reviewer,revision)
    values(p_check_id,p_call_id,p_field,p_action,answer,fingerprint,
      case when p_action='correct' then coalesce(p_corrected_value,'null'::jsonb) else null end,
      trim(p_reviewer),latest_revision+1) returning * into review;
  return jsonb_build_object('review',to_jsonb(review)||jsonb_build_object('source_current',true));
end;
$$;
revoke all on function read_heartbeat_answer_reviews(uuid,text) from public,anon,authenticated;
revoke all on function save_heartbeat_answer_review(uuid,text,text,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function read_heartbeat_answer_reviews(uuid,text) to service_role;
grant execute on function save_heartbeat_answer_review(uuid,text,text,text,text,integer,text,jsonb) to service_role;
