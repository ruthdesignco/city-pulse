-- Ingest schema for live Muni vehicles (see SPEC.md, "Architecture sketch").
--
-- Access model:
--   * Every table has RLS enabled and no policies, and anon/authenticated have
--     no table grants. Only service_role (the poller Edge Function) touches them.
--   * The browser (anon key) can read exactly one thing: the current_state view.
--     The view runs with its owner's rights (security_invoker = false), which is
--     how anon reads it without any access to the tables underneath. The
--     Supabase advisor flags this as a "security definer view"; it is intended.
--   * current_state exposes only what the browser renders: vehicle id, route,
--     direction, two timestamped positions, and per-layer freshness timestamps.
--     It never exposes ingest_runs error text, HTTP statuses, counts, trip ids,
--     or anything from poll_budget.

-- ---------------------------------------------------------------- tables

create table public.vehicle_observations (
  source          text             not null check (source <> ''),
  upstream_id     text             not null check (upstream_id <> ''),
  -- Vehicle's own GTFS-RT timestamp; the poller falls back to the feed header's.
  feed_timestamp  timestamptz      not null,
  route_id        text,
  trip_id         text,
  direction_id    smallint         check (direction_id in (0, 1)),
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  bearing         real,
  speed           real,
  ingested_at     timestamptz      not null default now(),
  primary key (source, upstream_id, feed_timestamp)
);

comment on table public.vehicle_observations is
  'Last two observations per vehicle, for interpolation. Pruned by record_vehicle_observations().';

create table public.ingest_runs (
  id             bigint generated always as identity primary key,
  source         text        not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- 'running' rows that never finish mean the function died mid-poll.
  status         text        not null default 'running'
                 check (status in ('running', 'ok', 'skipped_interval', 'skipped_budget', 'error')),
  http_status    integer,
  feed_entities  integer,
  in_area        integer,
  rows_written   integer,
  -- Redacted by the poller before writing; never exposed through current_state.
  error          text
);

comment on table public.ingest_runs is
  'One row per poller invocation, including skipped ones.';

create index ingest_runs_source_status_finished_idx
  on public.ingest_runs (source, status, finished_at desc);
create index ingest_runs_started_idx
  on public.ingest_runs (started_at);

create table public.poll_budget (
  -- One row per upstream API key ('sf511' is shared by every 511 endpoint).
  source             text        primary key,
  last_call_at       timestamptz,
  window_started_at  timestamptz,
  calls_in_window    integer     not null default 0 check (calls_in_window >= 0),
  -- Compare-and-swap token: the poller claims a slot with
  -- update ... where version = <version it read>.
  version            bigint      not null default 0
);

comment on table public.poll_budget is
  'Rate-limit state per upstream key. 511 allows 60 requests/hour per key.';

insert into public.poll_budget (source) values ('sf511');

-- ------------------------------------------------------------------- RLS

alter table public.vehicle_observations enable row level security;
alter table public.ingest_runs          enable row level security;
alter table public.poll_budget          enable row level security;

-- Supabase's default privileges grant new public tables to anon and
-- authenticated; take that back so RLS isn't the only wall.
revoke all on public.vehicle_observations, public.ingest_runs, public.poll_budget
  from anon, authenticated;
grant select, insert, update, delete
  on public.vehicle_observations, public.ingest_runs, public.poll_budget
  to service_role;

-- ---------------------------------------------------------------- writes

-- Insert one poll's observations and prune to the last two per vehicle, in one
-- transaction. Idempotent: re-sending a vehicle's unchanged timestamp is a
-- no-op. Returns the number of new rows.
create function public.record_vehicle_observations(p_rows jsonb)
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

  -- Vehicles that left service or the area.
  delete from public.vehicle_observations
  where feed_timestamp < now() - interval '2 hours';

  return inserted;
end;
$$;

revoke all on function public.record_vehicle_observations(jsonb) from public, anon, authenticated;
grant execute on function public.record_vehicle_observations(jsonb) to service_role;

-- ------------------------------------------------------------------ read

-- One row. The browser polls this every 30 s.
--   generated_at  database clock, so the browser can correct its own
--   freshness     {muni: {last_success_at, last_poll_at, last_poll_ok, newest_feed_timestamp}}
--   vehicles      [{id, route_id, direction_id, latest: {t, lat, lng}, previous: {t, lat, lng} | null}]
--
-- Vehicles are kept if their latest point is within 10 minutes of the feed's
-- newest. That drops buses that left service, but if the whole feed dies the
-- last known buses stay (and the browser dims them) instead of vanishing.
-- previous is null unless it is on the same route and direction as latest, so
-- the browser never interpolates across a trip change onto another route.
create view public.current_state
with (security_invoker = false)
as
with ranked as (
  select upstream_id, route_id, direction_id, feed_timestamp, lat, lng,
         row_number() over (partition by upstream_id order by feed_timestamp desc) as rn
  from public.vehicle_observations
  where source = 'sf511-muni'
),
feed as (
  select max(feed_timestamp) as newest from ranked
),
polls as (
  select status, finished_at
  from public.ingest_runs
  where source = 'sf511-muni' and status in ('ok', 'error') and finished_at is not null
)
select
  now() as generated_at,
  jsonb_build_object(
    'muni', jsonb_build_object(
      'last_success_at',       (select max(finished_at) from polls where status = 'ok'),
      'last_poll_at',          (select max(finished_at) from polls),
      'last_poll_ok',          (select status = 'ok' from polls order by finished_at desc limit 1),
      'newest_feed_timestamp', (select newest from feed)
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
      and b.feed_timestamp >= feed.newest - interval '10 minutes'
  ), '[]'::jsonb) as vehicles;

revoke all on public.current_state from public, anon, authenticated;
grant select on public.current_state to anon, service_role;
