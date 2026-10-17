-- Heartbeat schema. Shared file: tell the team before changing it.
-- Run once in the Supabase SQL editor. Safe to re-run: it drops and recreates.

drop table if exists call_logs;
drop table if exists checks;
drop table if exists events;
drop table if exists clients;

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  risk_tier text not null check (risk_tier in ('red', 'yellow', 'green')),
  lives_alone boolean not null default false,
  uses_powered_equipment boolean not null default false,
  emergency_contact_name text not null,
  emergency_contact_phone text not null,
  usual_pickup_time time
);

create table events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  started_at timestamptz not null default now()
);

create table checks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'calling', 'ok', 'needs_human', 'no_answer', 'handled')),
  ladder_step int not null default 0 check (ladder_step between 0 and 4),
  next_action_at timestamptz,
  last_call_id text,
  summary text,
  flag_reason text,
  handled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_id, client_id)
);

create index checks_next_action_idx on checks (next_action_at) where status = 'no_answer';
create index checks_last_call_idx on checks (last_call_id);

create table call_logs (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references checks (id) on delete cascade,
  -- Unique so a repeated Retell webhook is ignored (idempotency).
  retell_call_id text not null unique,
  target text not null check (target in ('client', 'emergency_contact')),
  outcome text not null,
  transcript text,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- Keep updated_at fresh on every checks update.
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger checks_touch before update on checks
  for each row execute function touch_updated_at();

-- The dashboard reads with the anon key. All writes go through API routes with the service role.
alter table clients enable row level security;
alter table events enable row level security;
alter table checks enable row level security;
alter table call_logs enable row level security;

create policy "anon read clients" on clients for select using (true);
create policy "anon read events" on events for select using (true);
create policy "anon read checks" on checks for select using (true);

-- Realtime on checks.
alter publication supabase_realtime add table checks;
