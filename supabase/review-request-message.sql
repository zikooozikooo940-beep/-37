-- Replaces the request review function so custom approval notes are saved and notified.
-- Add optional admin messages to both approval and rejection notifications.
create or replace function public.review_join_request(
  p_request_id uuid,p_decision text,p_reason text,p_actor_id uuid
) returns table(request_id uuid,user_id uuid,requested_role public.member_role,decision text)
language plpgsql security definer set search_path=public as $$
declare r public.role_requests%rowtype; new_status public.member_status; notice text; review_message text;
begin
  review_message:=trim(coalesce(p_reason,''));
  if p_decision not in ('approved','rejected') or length(review_message)>500 or
     (p_decision='rejected' and length(review_message)<3) then
    raise exception 'invalid_review_decision';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.role='super_admin' and p.status='approved') then
    raise exception 'super_admin_required';
  end if;
  select * into r from public.role_requests where id=p_request_id for update;
  if not found or r.status<>'pending' then raise exception 'request_not_pending'; end if;
  new_status:=p_decision::public.member_status;
  update public.role_requests set status=p_decision::public.request_status,
    reviewer_id=p_actor_id,reviewer_note=nullif(review_message,''),updated_at=now() where id=r.id;
  update public.profiles set status=new_status,
    approved_by=case when p_decision='approved' then p_actor_id else null end,
    approved_at=case when p_decision='approved' then now() else null end
    where id=r.user_id;
  if not found then raise exception 'profile_not_found'; end if;
  if p_decision='approved' then
    notice:='تمت الموافقة على طلبك. مرحبًا بك في دوري قاضي عياض.'||
      case when review_message<>'' then E'\n\nرسالة الإدارة: '||review_message else '' end;
  else
    notice:='لم تتم الموافقة على طلب الانضمام. السبب: '||review_message;
  end if;
  insert into public.notifications(user_id,kind,message) values(r.user_id,'request_'||p_decision,notice);
  insert into public.audit_log(actor_id,action,entity,entity_id,details)
    values(p_actor_id,'request_'||p_decision,'role_requests',r.id::text,jsonb_build_object('message',nullif(review_message,'')));
  return query select r.id,r.user_id,r.requested_role,p_decision;
end; $$;
revoke all on function public.review_join_request(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.review_join_request(uuid,text,text,uuid) to service_role;
