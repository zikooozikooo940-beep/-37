-- Public, read-only league data. Views expose only fields needed by the website.
-- Run after schema.sql in Supabase SQL Editor.
create or replace view public.public_tournaments as
select id,name,status,capacity,week_start,week_end,draw_at,created_at
from public.tournaments
where status in ('registration','scheduled','active','completed');

create or replace view public.public_matches as
select m.id,m.tournament_id,m.round_name,m.round_number,m.match_number,
       m.team1,m.team2,m.score1,m.score2,m.winner,m.match_at,m.status
from public.matches m
join public.tournaments t on t.id=m.tournament_id
where t.status in ('registration','scheduled','active','completed');

create or replace view public.public_players as
select p.id,p.display_name,
       nullif(p.player_data->>'team','') as team,
       nullif(p.player_data->>'position','') as position
from public.profiles p
where p.role='player' and p.status='approved';

create or replace view public.public_player_stats as
select s.player_id,s.goals,s.assists,s.appearances,s.motm_count
from public.player_stats s
join public.profiles p on p.id=s.player_id
where p.role='player' and p.status='approved';

create or replace view public.public_announcements as
select id,title,body,image_url,created_at,published
from public.announcements
where published=true;

create or replace view public.public_archives as
select id,season,winner,stats,archived_at
from public.archives;

revoke all on public.public_tournaments,public.public_matches,public.public_players,
  public.public_player_stats,public.public_announcements,public.public_archives
  from public,anon,authenticated;
grant usage on schema public to anon;
grant select on public.public_tournaments,public.public_matches,public.public_players,
  public.public_player_stats,public.public_announcements,public.public_archives to anon;
grant select on public.public_tournaments,public.public_matches,public.public_players,
  public.public_player_stats,public.public_announcements,public.public_archives to authenticated;

comment on view public.public_players is 'Publicly visible approved player names and optional team/position only.';
comment on view public.public_player_stats is 'Public statistics for approved players only.';
