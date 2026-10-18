-- Secure player removal: only approved super admins may suspend an approved player.
-- This function avoids broad UPDATE grants on profiles.
create or replace function public.remove_approved_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'super_admin_required' using errcode = '42501';
  end if;

  update public.profiles
     set status = 'suspended'
   where id = p_player_id
     and role = 'player'
     and status = 'approved';

  if not found then
    raise exception 'approved_player_not_found';
  end if;

  update public.teams
     set captain_id = null
   where captain_id = p_player_id;
end;
$$;

revoke all on function public.remove_approved_player(uuid) from public;
grant execute on function public.remove_approved_player(uuid) to authenticated;
