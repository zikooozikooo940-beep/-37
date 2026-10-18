-- Run once in Supabase SQL Editor after schema.sql.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  captain_id uuid references public.profiles(id) on delete set null,
  logo_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(tournament_id,name)
);
create table if not exists public.team_complaints (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  body text not null check(length(trim(body)) between 3 and 2000),
  status text not null default 'pending' check(status in ('pending','review','resolved')),
  created_at timestamptz not null default now()
);
alter table public.teams enable row level security;
alter table public.team_complaints enable row level security;
grant select,insert,update,delete on public.teams,public.team_complaints to authenticated;
drop policy if exists "approved members read teams" on public.teams;
create policy "approved members read teams" on public.teams for select to authenticated using(public.is_approved_member());
drop policy if exists "managers manage teams" on public.teams;
create policy "managers manage teams" on public.teams for all to authenticated using(public.is_manager()) with check(public.is_manager());
drop policy if exists "managers and submitters read complaints" on public.team_complaints;
create policy "managers and submitters read complaints" on public.team_complaints for select to authenticated using(public.is_manager() or submitted_by=auth.uid());
drop policy if exists "assigned captains submit complaints" on public.team_complaints;
create policy "assigned captains submit complaints" on public.team_complaints for insert to authenticated with check(submitted_by=auth.uid() and status='pending' and exists(select 1 from public.teams t where t.id=team_id and t.captain_id=auth.uid()));
drop policy if exists "managers review complaints" on public.team_complaints;
create policy "managers review complaints" on public.team_complaints for update to authenticated using(public.is_manager()) with check(public.is_manager());
create or replace view public.public_teams as
select t.id,t.tournament_id,t.name,t.logo_path,p.display_name as captain_name
from public.teams t left join public.profiles p on p.id=t.captain_id
join public.tournaments tr on tr.id=t.tournament_id
where tr.status in ('registration','scheduled','active','completed');
revoke all on public.public_teams from public,anon,authenticated;
grant select on public.public_teams to anon,authenticated;
