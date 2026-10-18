-- Stable fictional staff identities shared by profiles, tasks and the team directory.
create table care_staff (
 id text primary key, name text not null, role text not null check(role in ('administrator','nurse','aide')),
 facility_id text references care_facilities(id), initials text not null
);
insert into care_staff values
 ('demo-administrator','Alex Morgan','administrator',null,'AM'),
 ('demo-nurse','Jordan Lee','nurse','hollywood','JL'),
 ('demo-nurse-pasadena','Sam Rivera','nurse','pasadena','SR'),
 ('demo-nurse-culver','Jamie Brooks','nurse','culver-city','JB'),
 ('demo-aide-hollywood','Sofia Reyes','aide','hollywood','SR'),
 ('demo-aide-pasadena','Daniel Moore','aide','pasadena','DM'),
 ('demo-aide-culver','Robin Ellis','aide','culver-city','RE');
alter table care_profiles add column nurse_id text references care_staff(id);
alter table care_profiles add column aide_id text references care_staff(id);
update care_profiles set nurse_id=case facility_id when 'hollywood' then 'demo-nurse' when 'pasadena' then 'demo-nurse-pasadena' else 'demo-nurse-culver' end,
 aide_id='demo-aide-'||case facility_id when 'culver-city' then 'culver' else facility_id end;
alter table care_profiles alter column nurse_id set default 'demo-nurse';
alter table care_profiles alter column aide_id set default 'demo-aide-hollywood';
alter table care_tasks add column assigned_to text references care_staff(id);
update care_tasks t set assigned_to=p.nurse_id from care_profiles p where p.client_id=t.resident_id;
alter table care_tasks alter column assigned_to set default 'demo-nurse';
alter table care_tasks add column created_by text references care_staff(id) default 'demo-nurse';
alter table care_staff enable row level security;
revoke all on care_staff from anon, authenticated;
grant all on care_staff to service_role;
