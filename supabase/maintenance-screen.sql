-- Expose only the maintenance flag and visitor message to anonymous visitors.
create or replace view public.public_maintenance_status as
select
  coalesce((
    select (value #>> '{}')::boolean
    from public.settings
    where key = 'maintenance_mode'
  ), false) as enabled,
  coalesce((
    select value #>> '{}'
    from public.settings
    where key = 'maintenance_message'
  ), 'الموقع متوقف مؤقتًا للصيانة. سنعود قريبًا.') as message;

grant select on public.public_maintenance_status to anon, authenticated;
