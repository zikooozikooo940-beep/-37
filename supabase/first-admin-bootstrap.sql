begin;

lock table auth.users, public.profiles, public.role_requests, public.audit_log
in share row exclusive mode;

create unique index if not exists first_admin_bootstrap_once on public.audit_log(action)
where action='first_admin_bootstrap';

do $$
declare
  first_user_id uuid;
  bootstrap_id bigint;
begin
  select users.id into first_user_id
  from auth.users as users
  order by users.created_at,users.id
  limit 1;

  if first_user_id is not null then
    insert into public.audit_log(action,entity,entity_id,details)
    values('first_admin_bootstrap','profiles',first_user_id::text,'{"source":"existing_accounts"}'::jsonb)
    on conflict do nothing returning id into bootstrap_id;

    if bootstrap_id is not null
      and not exists(select 1 from public.profiles where status='approved' and role in ('super_admin','admin')) then
      update public.profiles
      set role='super_admin',status='approved',approved_at=now(),approved_by=first_user_id
      where id=first_user_id and status in ('pending','approved');

      if found then
        update public.role_requests
        set status='approved',reviewer_id=first_user_id,
            reviewer_note='First registered account automatically approved',updated_at=now()
        where user_id=first_user_id and status in ('pending','review','exam','oral');
      end if;
    end if;
  end if;
end;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  requested public.member_role;
  bootstrap_id bigint;
begin
  if exists(select 1 from public.settings where key='system_closed' and value='true'::jsonb)
    or exists(select 1 from public.settings where key='registration_open' and value='false'::jsonb) then
    raise exception 'registration_closed';
  end if;
  requested := case when new.raw_user_meta_data->>'requested_role' in ('player','follower')
    then (new.raw_user_meta_data->>'requested_role')::public.member_role else 'follower'::public.member_role end;
  insert into public.audit_log(action,entity,entity_id,details)
  values('first_admin_bootstrap','profiles',new.id::text,'{"source":"registration"}'::jsonb)
  on conflict do nothing returning id into bootstrap_id;
  insert into public.profiles(id,display_name,role,status,player_data)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name','عضو جديد'),
    case when bootstrap_id is not null then 'super_admin'::public.member_role else requested end,
    case when bootstrap_id is not null then 'approved'::public.member_status else 'pending'::public.member_status end,
    coalesce(new.raw_user_meta_data->'player_data','{}'::jsonb));
  if bootstrap_id is not null then
    update public.profiles set approved_at=now(),approved_by=new.id where id=new.id;
  else
    insert into public.role_requests(user_id,requested_role,status) values(new.id,requested,'pending');
  end if;
  return new;
end; $$;

revoke all on function public.handle_new_user() from public,anon,authenticated;

commit;
