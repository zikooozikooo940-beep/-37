begin;

lock table auth.users, public.profiles, public.role_requests, public.audit_log
in share row exclusive mode;

create unique index if not exists first_admin_bootstrap_once on public.audit_log(action)
where action='first_admin_bootstrap';

do $$
declare
  owner_id uuid;
  owner_role public.member_role;
  owner_status public.member_status;
  confirmed_at timestamptz;
begin
  if (select count(*) from auth.users where lower(email)='zikooozikooo940@gmail.com')>1 then
    raise exception 'يوجد أكثر من حساب بهذا البريد. يلزم تحديد الحساب المقصود يدويًا.';
  end if;
  select users.id,users.email_confirmed_at,profiles.role,profiles.status
  into owner_id,confirmed_at,owner_role,owner_status
  from auth.users as users
  join public.profiles as profiles on profiles.id=users.id
  where lower(users.email)='zikooozikooo940@gmail.com';

  if owner_id is null then
    raise exception 'لم يوجد الحساب وملف عضويته في هذا المشروع. تحقق من المشروع والبريد قبل المتابعة.';
  end if;
  if confirmed_at is null then
    raise exception 'يجب تأكيد البريد الإلكتروني قبل تفعيل الإدارة.';
  end if;
  if owner_status not in ('pending','approved') then
    raise exception 'الحساب مرفوض أو موقوف؛ يلزم مراجعته يدويًا قبل تغيير صلاحياته.';
  end if;
  if exists(
    select 1 from public.profiles
    where id<>owner_id and status='approved' and role in ('super_admin','admin')
  ) then
    raise exception 'يوجد أدمن معتمد آخر. لم تُغيّر الصلاحيات لتجنب إنشاء أدمن ثانٍ.';
  end if;

  insert into public.audit_log(action,entity,entity_id,details)
  values('first_admin_bootstrap','profiles',owner_id::text,'{"source":"owner_activation"}'::jsonb)
  on conflict do nothing;

  update public.profiles
  set role='super_admin',status='approved',
      approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,owner_id)
  where id=owner_id;

  update public.role_requests
  set status='approved',reviewer_id=owner_id,
      reviewer_note='Owner account activated by the project administrator',updated_at=now()
  where user_id=owner_id and status in ('pending','review','exam','oral');

  if owner_role<>'super_admin' or owner_status<>'approved' then
    insert into public.audit_log(actor_id,action,entity,entity_id,details)
    values(owner_id,'owner_admin_activated','profiles',owner_id::text,'{"source":"sql_editor"}'::jsonb);
  end if;
end;
$$;

select profiles.display_name,profiles.role,profiles.status
from public.profiles as profiles
join auth.users as users on users.id=profiles.id
where lower(users.email)='zikooozikooo940@gmail.com';

commit;
