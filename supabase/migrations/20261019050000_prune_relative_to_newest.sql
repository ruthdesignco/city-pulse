-- Fix 5 (board of vibes, weekend 1): the 2 h prune in
-- record_vehicle_observations compared feed_timestamp to now(). A feed that
-- keeps returning 200 with a frozen header timestamp showed "stale" honestly
-- for 2 h, then one good poll wiped every row because now() kept moving even
-- though no new snapshot had arrived -- the pill then said "waiting for the
-- first update" for a feed that never actually went away.
--
-- The cutoff is now relative to the newest snapshot already on file, per
-- source: rows only age out once a newer snapshot has actually landed.

create or replace function public.record_vehicle_observations(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.vehicle_observations
    (source, upstream_id, feed_timestamp, route_id, trip_id, direction_id, lat, lng, bearing, speed)
  select r.source, r.upstream_id, r.feed_timestamp, r.route_id, r.trip_id, r.direction_id,
         r.lat, r.lng, r.bearing, r.speed
  from jsonb_to_recordset(p_rows) as r(
    source text, upstream_id text, feed_timestamp timestamptz, route_id text, trip_id text,
    direction_id smallint, lat double precision, lng double precision, bearing real, speed real)
  on conflict (source, upstream_id, feed_timestamp) do nothing;
  get diagnostics inserted = row_count;

  delete from public.vehicle_observations o
  using (
    select source, upstream_id, feed_timestamp,
           row_number() over (partition by source, upstream_id order by feed_timestamp desc) as rn
    from public.vehicle_observations
  ) ranked
  where o.source = ranked.source
    and o.upstream_id = ranked.upstream_id
    and o.feed_timestamp = ranked.feed_timestamp
    and ranked.rn > 2;

  -- Vehicles that left service or the area: relative to the newest snapshot
  -- per source, not now(), so a dead feed never self-wipes (see comment above).
  delete from public.vehicle_observations o
  where o.feed_timestamp < (
    select max(i.feed_timestamp) - interval '2 hours'
    from public.vehicle_observations i
    where i.source = o.source
  );

  return inserted;
end;
$$;

revoke all on function public.record_vehicle_observations(jsonb) from public, anon, authenticated;
grant execute on function public.record_vehicle_observations(jsonb) to service_role;
