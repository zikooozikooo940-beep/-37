-- طبّق هذا الملف مرة واحدة في Supabase SQL Editor لتحديث القرعة في المشروع الحالي.
begin;
drop function if exists public.run_tournament_draw(uuid);
drop function if exists public.run_tournament_draw(uuid,text[]);
create or replace function public.run_tournament_draw(p_tournament_id uuid,p_team_names text[]) returns integer
language plpgsql security definer set search_path=public as $$
declare
  team_names text[];
  entries text[];
  member_row record;
  team_count integer;
  player_count integer;
  team_index integer;
  assigned_team text;
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

  select array_agg(btrim(name) order by ord)
    into team_names
    from unnest(p_team_names) with ordinality as input(name,ord)
    where btrim(name)<>'';
  team_count:=coalesce(array_length(team_names,1),0);
  if team_count<2 or team_count>256 then raise exception 'invalid_team_count'; end if;
  if team_count<>(select capacity from public.tournaments where id=p_tournament_id) then
    raise exception 'team_count_must_match_tournament_capacity';
  end if;
  if exists(select 1 from unnest(team_names) as names(name) where length(name)>80) then
    raise exception 'team_name_too_long';
  end if;
  if (select count(*)<>count(distinct lower(name)) from unnest(team_names) as names(name)) then
    raise exception 'team_names_must_be_unique';
  end if;
  if (team_count & (team_count-1))<>0 then raise exception 'team_count_must_be_power_of_two'; end if;

  select count(*) into player_count from public.profiles
    where role='player' and status='approved';
  if player_count<team_count then raise exception 'need_at_least_one_approved_player_per_team'; end if;

  -- Randomly distribute every approved player as evenly as possible across the official names.
  for member_row in
    select id,row_number() over(order by random()) as roster_no
    from public.profiles where role='player' and status='approved'
  loop
    team_index:=((member_row.roster_no-1)%team_count+1)::integer;
    assigned_team:=team_names[team_index];
    insert into public.registrations(tournament_id,user_id,registration_status,team_name)
      values(p_tournament_id,member_row.id,'approved',assigned_team)
      on conflict(tournament_id,user_id) do update
      set registration_status='approved',team_name=excluded.team_name;
  end loop;

  -- Shuffle the official teams independently to make the first-round matchups.
  select array_agg(name order by random()) into entries
    from unnest(team_names) as team(name);
  while (2^round_count)<team_count loop round_count:=round_count+1; end loop;
  match_count:=team_count/2;
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
  select r.user_id,'draw_started','تم توزيع اللاعبين وإجراء قرعة البطولة. شاهد الفرق والمواجهات.'
  from public.registrations r where r.tournament_id=p_tournament_id and r.registration_status='approved'
  on conflict do nothing;
  insert into public.audit_log(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'run_draw','tournaments',p_tournament_id::text,jsonb_build_object('teams',team_count,'players',player_count,'matches',total));
  return total;
end; $$;
revoke all on function public.run_tournament_draw(uuid,text[]) from public,anon;
grant execute on function public.run_tournament_draw(uuid,text[]) to authenticated;
commit;
