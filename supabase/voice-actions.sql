-- Additive migration. Run once on the existing Heartbeat Supabase project.
-- Do not re-run schema.sql: that file drops existing application tables.
create table if not exists public.voice_actions (
  id uuid primary key default gen_random_uuid(),
  parent_call_id text not null,
  request_key text not null,
  contact_id text not null,
  purpose text not null,
  external_call_id text,
  status text not null default 'dispatching'
    check (status in ('dispatching', 'queued', 'completed', 'failed', 'unknown')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique (parent_call_id, request_key)
);
alter table public.voice_actions enable row level security;
revoke all on public.voice_actions from anon, authenticated;
grant all on public.voice_actions to service_role;

-- Serialize claims per parent call so retries and concurrent workers cannot dial
-- twice or exceed five total outbound attempts. Only the server may invoke this.
create or replace function public.claim_voice_action(
  p_parent_call_id text, p_request_key text, p_contact_id text, p_purpose text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  existing public.voice_actions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_parent_call_id, 0));
  select * into existing from public.voice_actions
    where parent_call_id = p_parent_call_id and request_key = p_request_key;
  if found then
    return jsonb_build_object('created', false, 'action', to_jsonb(existing));
  end if;
  if (select count(*) from public.voice_actions where parent_call_id = p_parent_call_id) >= 5 then
    raise exception 'Outbound call limit reached';
  end if;
  insert into public.voice_actions (parent_call_id, request_key, contact_id, purpose)
    values (p_parent_call_id, p_request_key, p_contact_id, p_purpose)
    returning * into existing;
  return jsonb_build_object('created', true, 'action', to_jsonb(existing));
end;
$$;
revoke all on function public.claim_voice_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_voice_action(text, text, text, text) to service_role;
