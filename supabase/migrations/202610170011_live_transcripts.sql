-- Ordinary provider transcript snapshots; separate from final-analysis call_logs.
create table if not exists heartbeat_call_transcripts (
  call_id text primary key,
  check_id uuid not null references checks(id) on delete cascade,
  target text not null check (target in ('client','emergency_contact')),
  status text not null check (status in ('ongoing','ended','analyzed')),
  turns jsonb not null default '[]'::jsonb check (jsonb_typeof(turns)='array'),
  turn_count integer not null default 0,
  end_seconds double precision,
  character_count integer not null default 0,
  truncated boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists heartbeat_call_transcripts_check_idx on heartbeat_call_transcripts(check_id);
alter table heartbeat_call_transcripts enable row level security;
revoke all on heartbeat_call_transcripts from public, anon, authenticated;
grant all on heartbeat_call_transcripts to service_role;

create or replace function apply_heartbeat_transcript(
  p_check_id uuid, p_call_id text, p_target text, p_status text,
  p_turns jsonb, p_end_seconds double precision, p_truncated boolean
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  c checks%rowtype; prior heartbeat_call_transcripts%rowtype;
  incoming_count integer; incoming_chars integer; prior_rank integer; next_rank integer;
  content_advances boolean; prefix_extension boolean;
begin
  -- Same row lock as the final-analysis ledger: a late live event cannot race
  -- a committed final result or switch to a newly assigned call/target.
  select * into c from checks where id=p_check_id for update;
  if not found then return jsonb_build_object('skipped','unknown'); end if;
  if c.status='handled' or c.handled_at is not null then return jsonb_build_object('skipped','handled'); end if;
  if c.last_call_id is distinct from p_call_id then return jsonb_build_object('skipped','stale_call'); end if;
  if p_target is distinct from (case when c.ladder_step=3 then 'emergency_contact' else 'client' end) then
    return jsonb_build_object('skipped','wrong_target');
  end if;
  if p_status not in ('ongoing','ended','analyzed') or p_status is null or
    jsonb_typeof(p_turns) is distinct from 'array' or jsonb_array_length(p_turns)>1000 or
    p_end_seconds<0 or p_end_seconds>86400 or p_end_seconds='NaN'::double precision then
    raise exception 'Invalid transcript snapshot';
  end if;
  if exists(select 1 from jsonb_array_elements(p_turns) t where
    coalesce(t->>'role','') not in ('agent','user') or jsonb_typeof(t->'content') is distinct from 'string' or
    coalesce(length(t->>'content'),6001)>6000 or jsonb_typeof(t->'id') is distinct from 'string') then
    raise exception 'Invalid transcript turn';
  end if;
  incoming_count := jsonb_array_length(p_turns);
  select coalesce(sum(length(t->>'content')),0) into incoming_chars from jsonb_array_elements(p_turns) t;
  if incoming_chars>500000 then raise exception 'Transcript snapshot too large'; end if;
  if p_status<>'analyzed' and exists(select 1 from call_logs where retell_call_id=p_call_id) then
    return jsonb_build_object('skipped','already_analyzed');
  end if;
  select * into prior from heartbeat_call_transcripts where call_id=p_call_id;
  if not found then
    insert into heartbeat_call_transcripts(call_id,check_id,target,status,turns,turn_count,end_seconds,character_count,truncated)
      values(p_call_id,p_check_id,p_target,p_status,p_turns,incoming_count,p_end_seconds,incoming_chars,coalesce(p_truncated,false));
    return jsonb_build_object('applied',true,'status',p_status);
  end if;
  if prior.check_id<>p_check_id or prior.target<>p_target then return jsonb_build_object('skipped','wrong_binding'); end if;
  prior_rank := case prior.status when 'analyzed' then 3 when 'ended' then 2 else 1 end;
  next_rank := case p_status when 'analyzed' then 3 when 'ended' then 2 else 1 end;
  if prior_rank=3 then return jsonb_build_object('skipped','already_analyzed','status',prior.status); end if;
  if next_rank<prior_rank then return jsonb_build_object('skipped','older_event','status',prior.status); end if;
  -- An exact retry still needs to reach the separately idempotent priority RPC:
  -- its first attempt might have failed after this snapshot committed.
  if next_rank=prior_rank and p_turns=prior.turns then
    return jsonb_build_object('duplicate',true,'status',prior.status);
  end if;
  -- Compare cumulative speech position, not webhook arrival time. With equal
  -- turn count and equal/missing word timing, only a strict prefix extension is
  -- ordered. A same-length ASR rewrite is ambiguous and keeps the first version
  -- until a later terminal event; never discard already received full turns.
  select not exists(select 1 from jsonb_array_elements(prior.turns) with ordinality as old(t,n)
    where old.t->>'role' is distinct from p_turns->(old.n::integer-1)->>'role'
      or left(p_turns->(old.n::integer-1)->>'content',length(old.t->>'content')) is distinct from old.t->>'content') into prefix_extension;
  content_advances := incoming_count>=prior.turn_count and
    (p_end_seconds is null or prior.end_seconds is null or p_end_seconds>=prior.end_seconds) and (
      incoming_count>prior.turn_count or
      (p_end_seconds is not null and (prior.end_seconds is null or p_end_seconds>prior.end_seconds)) or
      (next_rank>prior_rank and incoming_chars>=prior.character_count) or
      (incoming_chars>prior.character_count and prefix_extension));
  if next_rank=prior_rank and not content_advances then
    return jsonb_build_object('skipped','older_or_ambiguous_snapshot','status',prior.status);
  end if;
  update heartbeat_call_transcripts set status=p_status,
    turns=case when content_advances then p_turns else turns end,
    turn_count=case when content_advances then incoming_count else turn_count end,
    end_seconds=case when content_advances then coalesce(p_end_seconds,end_seconds) else end_seconds end,
    character_count=case when content_advances then incoming_chars else character_count end,
    truncated=case when content_advances then coalesce(p_truncated,false) else truncated end,
    updated_at=now() where call_id=p_call_id;
  return jsonb_build_object('applied',true,'status',p_status);
end;
$$;
revoke all on function apply_heartbeat_transcript(uuid,text,text,text,jsonb,double precision,boolean) from public,anon,authenticated;
grant execute on function apply_heartbeat_transcript(uuid,text,text,text,jsonb,double precision,boolean) to service_role;
