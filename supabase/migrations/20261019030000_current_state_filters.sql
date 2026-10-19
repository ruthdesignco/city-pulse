-- current_state: hide out-of-service vehicles, and drop vehicles that have
-- left the feed after two consecutive polls instead of after 10 minutes.
--
-- 511 stamps every vehicle in a poll with the feed's single timestamp, so
-- each distinct feed_timestamp is one feed snapshot. A vehicle is shown while
-- its latest point is in the newest snapshot or the one before it (it missed
-- at most one poll). The cutoff is relative to the newest snapshot, never to
-- now(): when the feed dies, no new snapshots arrive and every bus stays,
-- frozen and dimmed by the browser.
--
-- If 511 ever sends per-vehicle timestamps, snapshots stop being polls and
-- this rule would drop nearly everything; revisit it then.
--
-- Vehicles without a route_id (in yards, deadheading) are stored and logged
-- but no longer exposed: the browser has nothing to draw them on.
--
-- Same columns, owner and grants as before; anon still reads only this view.

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
      and b.route_id is not null
      and b.feed_timestamp >= feed.keep_from
  ), '[]'::jsonb) as vehicles;

-- create or replace keeps these, but state them so this file stands alone.
revoke all on public.current_state from public, anon, authenticated;
grant select on public.current_state to anon, service_role;
