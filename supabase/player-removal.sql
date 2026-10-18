-- Allow admins and super admins to remove an approved player by suspending the profile.
-- This policy is intentionally limited to player profiles and the suspended status.
create or replace function public.can_remove_players()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'approved'
      and p.role in ('super_admin', 'admin')
  );
$$;

revoke all on function public.can_remove_players() from public;
grant execute on function public.can_remove_players() to authenticated;

drop policy if exists admins_remove_approved_players on public.profiles;
create policy admins_remove_approved_players
on public.profiles
for update
to authenticated
using (public.can_remove_players() and role = 'player' and status = 'approved')
with check (public.can_remove_players() and role = 'player' and status = 'suspended');
