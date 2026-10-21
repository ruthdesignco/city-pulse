-- Wind for the Bay's ripples and the trees' sway (SPEC.md, "Wind"):
-- current_state.weather gains wind_observed_at, the time of the report the
-- wind came from, so the browser can show its age and drop wind older than
-- 90 minutes; and the lookback for a report with wind shrinks from 2 hours
-- to 90 minutes. KSFO's 5-minute reports usually leave out wind, so wind is
-- still the shown station's newest report that has it.
--
--   weather  {station, observed_at, visibility_m, cloud_layers,
--             wind_speed_ms, wind_dir_deg, wind_observed_at} | null
--
-- wind_speed_ms, wind_dir_deg and wind_observed_at are all null when the
-- station has no report with wind in the 90 minutes before its newest.
-- Everything else is exactly 20261020120000_weather_observations.sql.

create or replace view public.current_state
with (security_invoker = false)
as
with ranked as (
  select upstream_id, route_id, direction_id, feed_timestamp, lat, lng,
         row_number() over (partition by upstream_id order by feed_timestamp desc) as rn
  from public.vehicle_observations
  where source = 'sf511-muni'
),
snapshots as (
  select feed_timestamp, row_number() over (order by feed_timestamp desc) as k
  from (select distinct feed_timestamp from ranked) d
),
feed as (
  select max(feed_timestamp) as newest,
         -- the second-newest snapshot, or the newest if there is only one
         min(feed_timestamp) filter (where k <= 2) as keep_from
  from snapshots
),
polls as (
  select status, finished_at
  from public.ingest_runs
  where source = 'sf511-muni' and status in ('ok', 'error') and finished_at is not null
),
weather_polls as (
  select status, finished_at
  from public.ingest_runs
  where source = 'nws' and status in ('ok', 'error') and finished_at is not null
),
newest_by_station as (
  select station, max(observed_at) as newest
  from public.weather_observations
  group by station
),
chosen_station as (
  select s.station
  from newest_by_station s
  cross join (select max(newest) as newest from newest_by_station) overall
  order by (s.station = 'KSFO' and s.newest >= overall.newest - interval '90 minutes') desc,
           s.newest desc
  limit 1
),
weather as (
  select w.*
  from public.weather_observations w
  join chosen_station c on c.station = w.station
  order by w.observed_at desc
  limit 1
),
wind as (
  select w.wind_speed_ms, w.wind_dir_deg, w.observed_at
  from public.weather_observations w
  join weather n on n.station = w.station
  where w.wind_speed_ms is not null
    and w.observed_at >= n.observed_at - interval '90 minutes'
  order by w.observed_at desc
  limit 1
)
select
  now() as generated_at,
  jsonb_build_object(
    'muni', jsonb_build_object(
      'last_success_at',       (select max(finished_at) from polls where status = 'ok'),
      'last_poll_at',          (select max(finished_at) from polls),
      'last_poll_ok',          (select status = 'ok' from polls order by finished_at desc limit 1),
      'newest_feed_timestamp', (select newest from feed)
    ),
    'weather', jsonb_build_object(
      'last_success_at',    (select max(finished_at) from weather_polls where status = 'ok'),
      'last_poll_at',       (select max(finished_at) from weather_polls),
      'last_poll_ok',       (select status = 'ok' from weather_polls order by finished_at desc limit 1),
      'newest_observed_at', (select observed_at from weather),
      'station',            (select station from weather)
    )
  ) as freshness,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',           b.upstream_id,
        'route_id',     b.route_id,
        'direction_id', b.direction_id,
        'latest',       jsonb_build_object('t', b.feed_timestamp, 'lat', b.lat, 'lng', b.lng),
        'previous',     case when a.upstream_id is null then null
                             else jsonb_build_object('t', a.feed_timestamp, 'lat', a.lat, 'lng', a.lng) end
      )
      order by b.upstream_id
    )
    from ranked b
    cross join feed
    left join ranked a
      on a.upstream_id = b.upstream_id
     and a.rn = 2
     and a.route_id is not distinct from b.route_id
     and a.direction_id is not distinct from b.direction_id
    where b.rn = 1
      and b.route_id is not null
      and b.feed_timestamp >= feed.keep_from
  ), '[]'::jsonb) as vehicles,
  (
    select jsonb_build_object(
      'station',       w.station,
      'observed_at',   w.observed_at,
      'visibility_m',  w.visibility_m,
      'cloud_layers',  w.cloud_layers,
      'wind_speed_ms', (select wind_speed_ms from wind),
      'wind_dir_deg',  (select wind_dir_deg from wind),
      'wind_observed_at', (select observed_at from wind)
    )
    from weather w
  ) as weather;

-- create or replace keeps these, but state them so this file stands alone.
revoke all on public.current_state from public, anon, authenticated;
grant select on public.current_state to anon, service_role;
