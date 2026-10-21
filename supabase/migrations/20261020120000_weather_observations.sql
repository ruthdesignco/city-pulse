-- Weather from the National Weather Service (api.weather.gov): visibility,
-- cloud layers and wind, for the scene's fog and clouds (SPEC.md, "Real fog
-- and clouds"). The poller fetches the last hour or so of observations from
-- KSFO (SFO airport, 18 km south: the nearest station reporting visibility
-- and clouds; "San Francisco Downtown", SFOC1, reports temperature only)
-- every 15 minutes, and KOAK (Oakland airport) too whenever KSFO has
-- reported nothing for 90 minutes.
--
-- Same access model as the vehicle tables: RLS on, no policies, no client
-- grants; the browser reads only current_state. Weather poller runs log to
-- ingest_runs as source 'nws'. The Healthchecks trigger fires on them too,
-- but pings only for a source with new vehicle observations, so it never
-- pings for weather.

-- ---------------------------------------------------------------- table

create table public.weather_observations (
  station        text             not null check (station <> ''),
  observed_at    timestamptz      not null,
  visibility_m   real,
  -- [{amount: 'FEW'|'SCT'|'BKN'|'OVC'|'CLR'|'SKC'|'VV', base_m: number|null}], lowest first
  cloud_layers   jsonb            not null default '[]'::jsonb check (jsonb_typeof(cloud_layers) = 'array'),
  wind_speed_ms  real,
  wind_dir_deg   real,
  wind_gust_ms   real,
  description    text,
  ingested_at    timestamptz      not null default now(),
  primary key (station, observed_at)
);

comment on table public.weather_observations is
  'NWS station observations (KSFO, KOAK fallback). Pruned to 14 days by record_weather_observations().';

alter table public.weather_observations enable row level security;
revoke all on public.weather_observations from public, anon, authenticated;
grant select, insert, update, delete on public.weather_observations to service_role;

-- ---------------------------------------------------------------- writes

-- Insert one fetch's observations (a station resends the same ones for an
-- hour, so most are no-ops) and drop anything 14 days older than that
-- station's newest. Returns the number of new rows.
create function public.record_weather_observations(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.weather_observations
    (station, observed_at, visibility_m, cloud_layers, wind_speed_ms, wind_dir_deg, wind_gust_ms, description)
  select r.station, r.observed_at, r.visibility_m, coalesce(r.cloud_layers, '[]'::jsonb),
         r.wind_speed_ms, r.wind_dir_deg, r.wind_gust_ms, r.description
  from jsonb_to_recordset(p_rows) as r(
    station text, observed_at timestamptz, visibility_m real, cloud_layers jsonb,
    wind_speed_ms real, wind_dir_deg real, wind_gust_ms real, description text)
  on conflict (station, observed_at) do nothing;
  get diagnostics inserted = row_count;

  -- Relative to each station's newest, not now(), like the vehicle prune.
  delete from public.weather_observations o
  where o.observed_at < (
    select max(i.observed_at) - interval '14 days'
    from public.weather_observations i
    where i.station = o.station
  );

  return inserted;
end;
$$;

revoke all on function public.record_weather_observations(jsonb) from public, anon, authenticated;
grant execute on function public.record_weather_observations(jsonb) to service_role;

-- ------------------------------------------------------------------ read

-- current_state gains a weather column and freshness.weather. Everything
-- else is exactly 20261019030000_current_state_filters.sql.
--
--   weather  {station, observed_at, visibility_m, cloud_layers,
--             wind_speed_ms, wind_dir_deg} | null
--   freshness.weather  {last_success_at, last_poll_at, last_poll_ok,
--                       newest_observed_at, station}
--
-- The station shown is KSFO unless KSFO's newest is more than 90 minutes
-- behind the newest observation on file (then KOAK, which the poller only
-- fetches in that case). Relative to the data, not now(), so a dead weather
-- feed keeps its last report and the browser labels it stale. KSFO's
-- 5-minute reports usually leave out wind, so wind comes from the station's
-- newest report that has it, within 2 hours.

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
  select w.wind_speed_ms, w.wind_dir_deg
  from public.weather_observations w
  join weather n on n.station = w.station
  where w.wind_speed_ms is not null
    and w.observed_at >= n.observed_at - interval '2 hours'
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
      'wind_dir_deg',  (select wind_dir_deg from wind)
    )
    from weather w
  ) as weather;

-- create or replace keeps these, but state them so this file stands alone.
revoke all on public.current_state from public, anon, authenticated;
grant select on public.current_state to anon, service_role;
