-- Additive local-demo care workspace. Existing outreach records remain intact.
create table care_facilities (
  id text primary key, name text not null, city text not null,
  latitude double precision, longitude double precision, staff integer not null default 0
);
insert into care_facilities values
 ('hollywood','Demo Hollywood House','Los Angeles',34.10,-118.33,6),
 ('pasadena','Demo Pasadena Gardens','Pasadena',34.14,-118.14,4),
 ('culver-city','Demo Culver Residence','Culver City',34.02,-118.40,4);

create table care_profiles (
  client_id uuid primary key references clients(id) on delete cascade,
  facility_id text not null references care_facilities(id), room text not null default '',
  nurse_name text not null default 'Jordan Lee (Demo)', aide_name text not null default 'Unassigned',
  allergies text[] not null default '{}', care_plan jsonb not null
);
create table care_vitals (
  id uuid primary key default gen_random_uuid(), resident_id uuid not null references clients(id) on delete cascade,
  facility_id text not null references care_facilities(id), organization_id text not null default 'heartbeat-fictional-demo',
  author jsonb not null, measured_at timestamptz not null, entered_at timestamptz not null default now(),
  readings jsonb not null, source text not null, observations text not null default '',
  supersedes uuid unique references care_vitals(id), correction_reason text not null default '',
  confirmed_entry_warnings jsonb not null default '[]',
  check (supersedes is null or length(trim(correction_reason)) > 0)
);
create index care_vitals_resident_time on care_vitals(resident_id, measured_at desc);
create table care_notes (
  id uuid primary key default gen_random_uuid(), resident_id uuid not null references clients(id) on delete cascade,
  kind text not null check (kind in ('note','reminders')), payload jsonb not null,
  author_name text not null, created_at timestamptz not null default now(),
  supersedes uuid unique references care_notes(id), correction_reason text not null default '',
  check (supersedes is null or length(trim(correction_reason)) > 0)
);
create table care_tasks (
  id uuid primary key default gen_random_uuid(), resident_id uuid not null references clients(id) on delete cascade,
  title text not null, status text not null default 'assigned' check (status in ('assigned','accepted','in_progress','completed')),
  due_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table care_acknowledgements (
  check_id uuid primary key references checks(id) on delete cascade, call_id text,
  acknowledged_by text not null, acknowledged_at timestamptz not null default now()
);
create table care_schedules (
  id uuid primary key default gen_random_uuid(), facility_id text not null unique references care_facilities(id),
  local_time time not null, enabled boolean not null default true
);
create table care_settings (
  id text primary key check (id='organization'), name text not null, timezone text not null
);
insert into care_settings values ('organization','Sunrise Home Care','America/Los_Angeles');
create table care_call_contexts (
  call_id text primary key, check_id uuid not null references checks(id) on delete cascade,
  resident_id uuid not null references clients(id) on delete cascade,
  context jsonb not null, created_at timestamptz not null default now()
);
alter table events add column facility_id text references care_facilities(id);
create index events_facility_started on events(facility_id, started_at desc);

-- These tables are accessed through the local-demo API, never with browser writes.
do $$ declare t text; begin
 foreach t in array array['care_facilities','care_profiles','care_vitals','care_notes','care_tasks','care_acknowledgements','care_schedules','care_settings','care_call_contexts'] loop
   execute format('alter table %I enable row level security',t);
   execute format('revoke all on %I from anon, authenticated',t);
   execute format('grant all on %I to service_role',t);
 end loop;
end $$;

-- Give the existing fictional roster facility membership without replacing it.
insert into care_profiles(client_id,facility_id,room,care_plan)
select id, (array['hollywood','pasadena','culver-city'])[1+((row_number() over(order by name)-1)%3)::int],
 (100+row_number() over(order by name))::text,
 '{"fields":["bp_sys","bp_dia","heart_rate","temperature","spo2","respiratory_rate","weight","blood_glucose"],"temperature_unit":"°F","weight_unit":"lb","glucose_unit":"mg/dL","max_age_hours":24,"timezone":"America/Los_Angeles","clinical_thresholds":{}}'::jsonb
from clients;

create function create_care_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into care_profiles(client_id,facility_id,room,care_plan) values(new.id,'hollywood','Not assigned',
 '{"fields":["bp_sys","bp_dia","heart_rate","temperature","spo2","respiratory_rate","weight","blood_glucose"],"temperature_unit":"°F","weight_unit":"lb","glucose_unit":"mg/dL","max_age_hours":24,"timezone":"America/Los_Angeles","clinical_thresholds":{}}'::jsonb);
 return new;
end $$;
revoke all on function create_care_profile() from public,anon,authenticated;
create trigger clients_care_profile after insert on clients for each row execute function create_care_profile();

insert into care_tasks(resident_id,title)
select distinct on (facility_id) client_id,'Complete initial care documentation'
from care_profiles order by facility_id,client_id;
