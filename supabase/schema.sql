-- مخطط PostgreSQL / Supabase لمنصة دوري جمعية قاضي عياض
-- شغّل هذا الملف في Supabase SQL Editor بعد إنشاء المشروع.
create extension if not exists pgcrypto;

create type public.member_role as enum ('super_admin','admin','referee','organizer','player','follower');
create type public.member_status as enum ('pending','approved','rejected','suspended');
create type public.tournament_status as enum ('draft','registration','scheduled','active','completed','archived','closed');
create type public.request_status as enum ('pending','review','exam','oral','approved','rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.member_role not null default 'follower',
  status public.member_status not null default 'pending',
  avatar_url text,
  player_data jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id)
);

-- لا تُخزّن كلمات مرور المشرف هنا؛ يستخدم المشرف حساب Auth مع MFA وسياسة وصول منفصلة.
create table public.super_admin_settings (
  singleton boolean primary key default true check (singleton),
  avatar_url text,
  public_visibility boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tournament_type text not null default 'single_elimination' check(tournament_type='single_elimination'),
  status public.tournament_status not null default 'draft',
  capacity integer not null default 8 check(capacity between 2 and 256),
  week_start date,
  week_end date,
  draw_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (week_end is null or week_start is null or week_end >= week_start)
);
create table public.registrations (
  tournament_id uuid references public.tournaments(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  registration_status public.member_status not null default 'pending',
  team_name text,
  registered_at timestamptz not null default now(),
  primary key (tournament_id,user_id)
);
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_name text not null,
  round_number integer not null check(round_number > 0),
  match_number integer not null check(match_number > 0),
  team1 text,
  team2 text,
  score1 integer check(score1 >= 0),
  score2 integer check(score2 >= 0),
  winner text,
  next_match_id uuid references public.matches(id),
  referee_id uuid references public.profiles(id),
  match_at timestamptz,
  status text not null default 'scheduled' check(status in ('scheduled','live','completed','cancelled')),
  created_at timestamptz not null default now(),
  unique(tournament_id,round_number,match_number)
);
create table public.player_stats (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  goals integer not null default 0 check(goals>=0),
  assists integer not null default 0 check(assists>=0),
  yellow_cards integer not null default 0 check(yellow_cards>=0),
  red_cards integer not null default 0 check(red_cards>=0),
  appearances integer not null default 0 check(appearances>=0),
  motm_count integer not null default 0 check(motm_count>=0),
  updated_at timestamptz not null default now()
);
create table public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role public.member_role not null check(requested_role in ('player','follower','referee')),
  status public.request_status not null default 'pending',
  exam_link text,
  exam_result jsonb,
  oral_result text,
  reviewer_id uuid references public.profiles(id),
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.player_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  visibility text not null default 'private' check(visibility in ('private','public')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.player_cards (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  design jsonb not null default '{}'::jsonb,
  badge text,
  updated_at timestamptz not null default now()
);
create table public.motm_votes (
  match_id uuid not null references public.matches(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(match_id,voter_id)
);
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  published boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.archives (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid unique references public.tournaments(id) on delete set null,
  season text not null,
  winner text,
  stats jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now()
);
create table public.images (
  id uuid primary key default gen_random_uuid(),
  type text not null check(type in ('logo','background','gallery','news','player','card')),
  storage_path text not null,
  title text,
  category text,
  sort_order integer not null default 0,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- إكمال ملف العضو لا يمنح اعتمادًا. المشرف يعتمد العضو صراحةً عبر إجراء موثوق بالخادم.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare requested public.member_role;
begin
  if exists(select 1 from public.settings where key='system_closed' and value='true'::jsonb)
    or exists(select 1 from public.settings where key='registration_open' and value='false'::jsonb) then
    raise exception 'registration_closed';
  end if;
  requested := case when new.raw_user_meta_data->>'requested_role' in ('player','follower')
    then (new.raw_user_meta_data->>'requested_role')::public.member_role else 'follower'::public.member_role end;
  insert into public.profiles(id,display_name,role,status,player_data)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name','عضو جديد'),requested,'pending',coalesce(new.raw_user_meta_data->'player_data','{}'::jsonb));
  insert into public.role_requests(user_id,requested_role,status) values(new.id,requested,'pending');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_approved_member() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='approved');
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='approved' and p.role in ('super_admin','admin','organizer','referee'));
$$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='approved' and p.role in ('super_admin','admin','organizer'));
$$;
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='approved' and p.role='super_admin');
$$;
create or replace function public.is_registration_open() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.settings s where s.key='registration_open'),true);
$$;

alter table public.profiles enable row level security;
alter table public.super_admin_settings enable row level security;
alter table public.tournaments enable row level security;
alter table public.registrations enable row level security;
alter table public.matches enable row level security;
alter table public.player_stats enable row level security;
alter table public.role_requests enable row level security;
alter table public.player_notes enable row level security;
alter table public.player_cards enable row level security;
alter table public.motm_votes enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.archives enable row level security;
alter table public.images enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- الصلاحيات على الجداول لا تكفي وحدها: كل القراءة والكتابة تمر أيضًا عبر RLS أدناه.
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
-- Members can change only their own avatar through the client; roles and approval status stay server-managed.
revoke update on public.profiles from authenticated;
grant update(avatar_url) on public.profiles to authenticated;

create policy "members see approved profiles" on public.profiles for select to authenticated using (public.is_approved_member() and status='approved' or id=auth.uid());
create policy "members update own pending profile" on public.profiles for update to authenticated using (id=auth.uid() and status='pending') with check(id=auth.uid() and role='follower' and status='pending');
create policy "members update own avatar" on public.profiles for update to authenticated
using(id=auth.uid() and status in ('pending','approved'))
with check(id=auth.uid() and status in ('pending','approved') and (avatar_url is null or avatar_url like 'avatars/'||auth.uid()::text||'/%'));
create policy "super admin manages profiles" on public.profiles for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "approved members read tournaments" on public.tournaments for select to authenticated using(public.is_approved_member());
create policy "managers manage tournaments" on public.tournaments for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "members read approved registrations" on public.registrations for select to authenticated using(public.is_approved_member());
create policy "members request registration" on public.registrations for insert to authenticated with check(
  user_id=auth.uid() and registration_status='pending' and public.is_approved_member()
  and public.is_registration_open()
  and exists(select 1 from public.tournaments t where t.id=tournament_id and t.status='registration')
);
create policy "managers manage registrations" on public.registrations for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "approved members read matches" on public.matches for select to authenticated using(public.is_approved_member());
create policy "managers create matches" on public.matches for insert to authenticated with check(public.is_manager());
create policy "approved members read stats" on public.player_stats for select to authenticated using(public.is_approved_member());
create policy "managers manage stats" on public.player_stats for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "own role requests readable" on public.role_requests for select to authenticated using(user_id=auth.uid() or public.is_super_admin());
create policy "submit own role request" on public.role_requests for insert to authenticated with check(user_id=auth.uid() and status='pending');
create policy "super admin reviews requests" on public.role_requests for update to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "read shared notes or own private notes" on public.player_notes for select to authenticated using(
  (visibility='public' and public.is_approved_member()) or created_by=auth.uid() or public.is_super_admin()
);
create policy "admins manage player notes" on public.player_notes for insert to authenticated with check(
  public.is_staff() and (select role from public.profiles where id=auth.uid()) in ('super_admin','admin','organizer') and created_by=auth.uid()
);
create policy "admins update player notes" on public.player_notes for update to authenticated using(
  public.is_staff() and (select role from public.profiles where id=auth.uid()) in ('super_admin','admin','organizer')
) with check(public.is_staff());
create policy "admins delete player notes" on public.player_notes for delete to authenticated using(
  public.is_staff() and (select role from public.profiles where id=auth.uid()) in ('super_admin','admin')
);
create policy "approved members read cards" on public.player_cards for select to authenticated using(public.is_approved_member());
create policy "managers manage cards" on public.player_cards for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "approved members read votes" on public.motm_votes for select to authenticated using(public.is_approved_member());
create policy "eligible users cast one vote" on public.motm_votes for insert to authenticated with check(voter_id=auth.uid() and public.is_approved_member() and exists(select 1 from public.profiles p where p.id=player_id and p.role='player' and p.status='approved'));
create policy "managers manage votes" on public.motm_votes for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "approved members read published news" on public.announcements for select to authenticated using(published and public.is_approved_member());
create policy "managers manage news" on public.announcements for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "read own notifications" on public.notifications for select to authenticated using(user_id=auth.uid());
create policy "update own notifications" on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
create policy "register own push subscription" on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid());
create policy "update own push subscription" on public.push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "remove own push subscription" on public.push_subscriptions for delete to authenticated using(user_id=auth.uid());
create policy "approved members read archives" on public.archives for select to authenticated using(public.is_approved_member());
create policy "managers manage archives" on public.archives for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "approved members read images" on public.images for select to authenticated using(public.is_approved_member());
create policy "managers manage images" on public.images for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "approved members read public settings" on public.settings for select to authenticated using(public.is_approved_member());
create policy "managers manage settings" on public.settings for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy "super admin read audit log" on public.audit_log for select to authenticated using(public.is_super_admin());

-- Accept/reject a join request as one database transaction so profile, request,
-- notification, and audit history cannot disagree after a partial failure.
create or replace function public.review_join_request(
  p_request_id uuid,p_decision text,p_reason text,p_actor_id uuid
) returns table(request_id uuid,user_id uuid,requested_role public.member_role,decision text)
language plpgsql security definer set search_path=public as $$
declare r public.role_requests%rowtype; new_status public.member_status; notice text;
begin
  if p_decision not in ('approved','rejected') or
     (p_decision='rejected' and (length(trim(coalesce(p_reason,'')))<3 or length(trim(p_reason))>500)) then
    raise exception 'invalid_review_decision';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.role='super_admin' and p.status='approved') then
    raise exception 'super_admin_required';
  end if;
  select * into r from public.role_requests where id=p_request_id for update;
  if not found or r.status<>'pending' then raise exception 'request_not_pending'; end if;
  new_status:=p_decision::public.member_status;
  update public.role_requests set status=p_decision::public.request_status,
    reviewer_id=p_actor_id,reviewer_note=case when p_decision='rejected' then trim(p_reason) else null end,
    updated_at=now() where id=r.id;
  update public.profiles set status=new_status,
    approved_by=case when p_decision='approved' then p_actor_id else null end,
    approved_at=case when p_decision='approved' then now() else null end
    where id=r.user_id;
  if not found then raise exception 'profile_not_found'; end if;
  notice:=case when p_decision='approved' then 'تمت الموافقة على طلبك. مرحبًا بك في دوري قاضي عياض.'
    else 'لم تتم الموافقة على طلب الانضمام. السبب: '||trim(p_reason) end;
  insert into public.notifications(user_id,kind,message) values(r.user_id,'request_'||p_decision,notice);
  insert into public.audit_log(actor_id,action,entity,entity_id,details)
    values(p_actor_id,'request_'||p_decision,'role_requests',r.id::text,jsonb_build_object('reason',case when p_decision='rejected' then trim(p_reason) else null end));
  return query select r.id,r.user_id,r.requested_role,p_decision;
end; $$;
revoke all on function public.review_join_request(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.review_join_request(uuid,text,text,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('league-media','league-media',false,5242880,array['image/jpeg','image/png','image/svg+xml','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create policy "approved members read league media" on storage.objects for select to authenticated
using(bucket_id='league-media' and public.is_approved_member());
create policy "members read own avatar" on storage.objects for select to authenticated
using(bucket_id='league-media' and name like 'avatars/'||auth.uid()::text||'/%');
create policy "members upload own avatar" on storage.objects for insert to authenticated
with check(bucket_id='league-media' and name like 'avatars/'||auth.uid()::text||'/%'
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('player','follower') and p.status in ('pending','approved')));
create policy "members update own avatar object" on storage.objects for update to authenticated
using(bucket_id='league-media' and name like 'avatars/'||auth.uid()::text||'/%')
with check(bucket_id='league-media' and name like 'avatars/'||auth.uid()::text||'/%');
create policy "members delete own avatar object" on storage.objects for delete to authenticated
using(bucket_id='league-media' and name like 'avatars/'||auth.uid()::text||'/%');
create policy "managers upload league media" on storage.objects for insert to authenticated
with check(bucket_id='league-media' and public.is_manager());
create policy "managers update league media" on storage.objects for update to authenticated
using(bucket_id='league-media' and public.is_manager()) with check(bucket_id='league-media' and public.is_manager());
create policy "managers delete league media" on storage.objects for delete to authenticated
using(bucket_id='league-media' and public.is_manager());

-- تشغيل القرعة وإنشاء الشجرة يتمان داخل معاملة واحدة وبصلاحية المشرف العام فقط.
create or replace function public.run_tournament_draw(p_tournament_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare
  entries text[];
  n integer;
  needed integer:=1;
  round_count integer:=0;
  round_no integer;
  match_count integer;
  match_no integer;
  previous_ids uuid[];
  current_ids uuid[];
  new_id uuid;
  total integer:=0;
begin
  if not public.is_super_admin() then raise exception 'super_admin_required'; end if;
  perform 1 from public.tournaments where id=p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if exists(select 1 from public.matches where tournament_id=p_tournament_id) then raise exception 'draw_already_run'; end if;
  select array_agg(team_name order by gen_random_uuid()) into entries
    from public.registrations where tournament_id=p_tournament_id and registration_status='approved' and team_name is not null;
  n:=coalesce(array_length(entries,1),0);
  if n<2 then raise exception 'need_at_least_two_approved_teams'; end if;
  while needed<n loop needed:=needed*2; end loop;
  if needed<>n then raise exception 'approved_team_count_must_be_power_of_two'; end if;
  while (2^round_count)<n loop round_count:=round_count+1; end loop;
  match_count:=n/2;
  for match_no in 1..match_count loop
    insert into public.matches(tournament_id,round_name,round_number,match_number,team1,team2,status)
    values(p_tournament_id,case when round_count=1 then 'النهائي' when round_count=2 then 'نصف النهائي' else 'ربع النهائي' end,1,match_no,entries[2*match_no-1],entries[2*match_no],'scheduled') returning id into new_id;
    previous_ids:=array_append(previous_ids,new_id); total:=total+1;
  end loop;
  for round_no in 2..round_count loop
    current_ids:=array[]::uuid[];
    match_count:=array_length(previous_ids,1)/2;
    for match_no in 1..match_count loop
      insert into public.matches(tournament_id,round_name,round_number,match_number,status)
      values(p_tournament_id,case when round_no=round_count then 'النهائي' when round_no=round_count-1 then 'نصف النهائي' else 'الدور التالي' end,round_no,match_no,'scheduled') returning id into new_id;
      update public.matches set next_match_id=new_id where id in(previous_ids[2*match_no-1],previous_ids[2*match_no]);
      current_ids:=array_append(current_ids,new_id); total:=total+1;
    end loop;
    previous_ids:=current_ids;
  end loop;
  update public.tournaments set status='active' where id=p_tournament_id;
  insert into public.notifications(user_id,kind,message)
  select r.user_id,'draw_started','تم إجراء قرعة البطولة. شاهد مواجهات دور خروج المغلوب.'
  from public.registrations r where r.tournament_id=p_tournament_id and r.registration_status='approved'
  on conflict do nothing;
  insert into public.audit_log(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'run_draw','tournaments',p_tournament_id::text,jsonb_build_object('teams',n,'matches',total));
  return total;
end; $$;
revoke all on function public.run_tournament_draw(uuid) from public,anon;
grant execute on function public.run_tournament_draw(uuid) to authenticated;

create or replace function public.record_match_result(p_match_id uuid,p_score1 integer,p_score2 integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare m public.matches%rowtype; winning_team text; actor_role public.member_role;
begin
  if p_score1<0 or p_score2<0 or p_score1=p_score2 then raise exception 'invalid_score'; end if;
  select role into actor_role from public.profiles where id=auth.uid() and status='approved';
  select * into m from public.matches where id=p_match_id for update;
  if not found then raise exception 'match_not_found'; end if;
  if actor_role is null or (actor_role not in ('super_admin','admin','organizer') and m.referee_id is distinct from auth.uid()) then raise exception 'not_authorized_for_match'; end if;
  winning_team:=case when p_score1>p_score2 then m.team1 else m.team2 end;
  update public.matches set score1=p_score1,score2=p_score2,winner=winning_team,status='completed' where id=p_match_id;
  if m.next_match_id is not null then
    update public.matches set team1=case when m.match_number%2=1 then winning_team else team1 end,
      team2=case when m.match_number%2=0 then winning_team else team2 end where id=m.next_match_id;
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'record_result','matches',p_match_id::text,jsonb_build_object('score1',p_score1,'score2',p_score2,'winner',winning_team));
  insert into public.notifications(user_id,kind,message)
  select distinct r.user_id,'team_won',winning_team||' فاز في المباراة بنتيجة '||p_score1::text||' – '||p_score2::text||'.'
  from public.registrations r where r.tournament_id=m.tournament_id and r.team_name=winning_team and r.registration_status='approved'
  on conflict do nothing;
  return m.next_match_id;
end; $$;
revoke all on function public.record_match_result(uuid,integer,integer) from public,anon;
grant execute on function public.record_match_result(uuid,integer,integer) to authenticated;

-- Storage: أنشئ bucket باسم league-media خاصًا، واربط الرفع والتحقق بمسارات users/{uid}/... عبر RLS.
-- لا تستخدم مفتاح service_role في المتصفح. عمليات اعتماد الأعضاء والترقية وإغلاق المنظومة
-- يجب أن تمر عبر Edge Function تتحقق من super_admin وتسجل كل تعديل في audit_log.
