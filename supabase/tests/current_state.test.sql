-- SQL fixture test for record_vehicle_observations() and the current_state
-- view (board of vibes, weekend 1, fix 9). Run against a scratch database
-- that already has the schema-defining migrations applied (ingest_schema,
-- current_state_filters, prune_relative_to_newest -- see
-- .github/workflows/ci.yml). Not the cron or vault migrations: those only
-- wire up Supabase-platform scheduling and secret storage, which this test
-- doesn't touch.
--
-- Run by hand against a local scratch Postgres:
--   createdb city_pulse_test
--   psql city_pulse_test -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20261018200000_ingest_schema.sql \
--     -f supabase/migrations/20261019030000_current_state_filters.sql \
--     -f supabase/migrations/20261019050000_prune_relative_to_newest.sql \
--     -f supabase/tests/current_state.test.sql
--   dropdb city_pulse_test
--
-- Every feed_timestamp here is in 2020, far from the wall clock: that's what
-- makes the "prune relative to the newest snapshot, not now()" assertion
-- below meaningful. If the prune ever goes back to now() - interval '2
-- hours', every row in this fixture becomes "older than 2h ago" and the
-- whole fixture silently empties instead of failing loudly, so the first
-- assertion checks that today's rows are still there.

begin;

\set ON_ERROR_STOP 1

-- Poll 0: a row from a feed snapshot long enough before the rest of this
-- fixture (and comfortably more than 2h before poll 3's "newest snapshot")
-- that it must be pruned once poll 3 lands.
select public.record_vehicle_observations('[
  {"source":"sf511-muni","upstream_id":"busZ","feed_timestamp":"2020-01-01T00:00:00Z",
   "route_id":"1","trip_id":"t-z0","direction_id":0,"lat":37.0,"lng":-122.0,"bearing":null,"speed":null}
]'::jsonb);

-- Poll 1 (T0). busA and busC both start on route 14; busB starts on route 20.
select public.record_vehicle_observations('[
  {"source":"sf511-muni","upstream_id":"busA","feed_timestamp":"2020-06-01T00:00:00Z",
   "route_id":"14","trip_id":"t-a0","direction_id":1,"lat":37.760,"lng":-122.420,"bearing":10,"speed":5},
  {"source":"sf511-muni","upstream_id":"busB","feed_timestamp":"2020-06-01T00:00:00Z",
   "route_id":"20","trip_id":"t-b0","direction_id":0,"lat":37.761,"lng":-122.421,"bearing":20,"speed":5},
  {"source":"sf511-muni","upstream_id":"busC","feed_timestamp":"2020-06-01T00:00:00Z",
   "route_id":"14","trip_id":"t-c0","direction_id":0,"lat":37.762,"lng":-122.422,"bearing":30,"speed":5}
]'::jsonb);

-- Poll 2 (T0 + 75s). busB misses this poll entirely. busC switches to route
-- 30 (a mid-trip reassignment): its previous fix was on a different route.
select public.record_vehicle_observations('[
  {"source":"sf511-muni","upstream_id":"busA","feed_timestamp":"2020-06-01T00:01:15Z",
   "route_id":"14","trip_id":"t-a0","direction_id":1,"lat":37.763,"lng":-122.423,"bearing":10,"speed":5},
  {"source":"sf511-muni","upstream_id":"busC","feed_timestamp":"2020-06-01T00:01:15Z",
   "route_id":"30","trip_id":"t-c1","direction_id":0,"lat":37.764,"lng":-122.424,"bearing":30,"speed":5}
]'::jsonb);

-- Poll 3 (T0 + 150s, the newest snapshot from here on). busB reappears, two
-- polls after its last one. busD shows up deadheading: no route_id. busC
-- doesn't report this poll, so its latest stays the T0+75s, route-30 fix.
-- Then a replayed batch (the poller retrying, or 511 resending): identical
-- rows, same feed_timestamp. Must be a no-op, not a duplicate or an error.
do $$
declare
  poll3_rows jsonb := '[
    {"source":"sf511-muni","upstream_id":"busA","feed_timestamp":"2020-06-01T00:02:30Z",
     "route_id":"14","trip_id":"t-a0","direction_id":1,"lat":37.765,"lng":-122.425,"bearing":10,"speed":5},
    {"source":"sf511-muni","upstream_id":"busB","feed_timestamp":"2020-06-01T00:02:30Z",
     "route_id":"20","trip_id":"t-b0","direction_id":0,"lat":37.766,"lng":-122.426,"bearing":20,"speed":5},
    {"source":"sf511-muni","upstream_id":"busD","feed_timestamp":"2020-06-01T00:02:30Z",
     "route_id":null,"trip_id":null,"direction_id":null,"lat":37.767,"lng":-122.427,"bearing":null,"speed":null}
  ]'::jsonb;
  inserted integer;
begin
  inserted := public.record_vehicle_observations(poll3_rows);
  if inserted <> 3 then
    raise exception 'FAIL: poll 3 should insert 3 new rows, got %', inserted;
  end if;

  inserted := public.record_vehicle_observations(poll3_rows);
  if inserted <> 0 then
    raise exception 'FAIL: a replayed batch should insert 0 rows, got %', inserted;
  end if;
end $$;

-- The 2 h prune: relative to the newest snapshot (poll 3), not the wall
-- clock -- every feed_timestamp above is in 2020, so a now()-relative prune
-- would have wiped everything already.
do $$
declare
  n integer;
begin
  select count(*) into n from public.vehicle_observations where upstream_id = 'busA';
  if n = 0 then
    raise exception 'FAIL: the fixture emptied itself -- the prune is comparing against now(), not the newest snapshot';
  end if;

  select count(*) into n from public.vehicle_observations where upstream_id = 'busZ';
  if n <> 0 then
    raise exception 'FAIL: busZ''s poll-0 row is 2.5 months older than the newest snapshot and should have been pruned, found %', n;
  end if;

  -- The separate "keep last two per vehicle" rule: busA has three distinct
  -- snapshots on file across polls 1-3, but only the newest two survive.
  select count(*) into n from public.vehicle_observations where upstream_id = 'busA';
  if n <> 2 then
    raise exception 'FAIL: busA should keep exactly 2 rows (last two snapshots), found %', n;
  end if;
end $$;

-- The view.
do $$
declare
  r record;
  vehicles jsonb;
  by_id jsonb;
begin
  select * into r from public.current_state;

  if (r.freshness -> 'muni' ->> 'newest_feed_timestamp')::timestamptz <> '2020-06-01T00:02:30Z'::timestamptz then
    raise exception 'FAIL: newest_feed_timestamp should be poll 3''s snapshot, got %', r.freshness -> 'muni' ->> 'newest_feed_timestamp';
  end if;

  vehicles := r.vehicles;
  by_id := (select jsonb_object_agg(v ->> 'id', v) from jsonb_array_elements(vehicles) v);

  if by_id ? 'busD' then
    raise exception 'FAIL: busD has no route_id (deadheading) and must not be exposed';
  end if;
  if by_id ? 'busZ' then
    raise exception 'FAIL: busZ was pruned and must not be exposed';
  end if;
  if not (by_id ? 'busA' and by_id ? 'busB' and by_id ? 'busC') then
    raise exception 'FAIL: expected busA, busB and busC in the view, got %', (select jsonb_agg(k) from jsonb_object_keys(by_id) k);
  end if;

  -- busA: three clean snapshots, interpolates from the one right before latest.
  if (by_id -> 'busA' -> 'latest' ->> 't')::timestamptz <> '2020-06-01T00:02:30Z'::timestamptz
     or (by_id -> 'busA' -> 'previous' ->> 't')::timestamptz <> '2020-06-01T00:01:15Z'::timestamptz then
    raise exception 'FAIL: busA should interpolate from T0+75s to T0+150s, got %', by_id -> 'busA';
  end if;

  -- busB: missed one poll. previous is still the last fix it actually sent
  -- (T0), not null and not the poll it skipped.
  if (by_id -> 'busB' -> 'latest' ->> 't')::timestamptz <> '2020-06-01T00:02:30Z'::timestamptz
     or (by_id -> 'busB' -> 'previous' ->> 't')::timestamptz <> '2020-06-01T00:00:00Z'::timestamptz then
    raise exception 'FAIL: busB should interpolate across its missed poll, from T0 to T0+150s, got %', by_id -> 'busB';
  end if;

  -- busC: didn't report poll 3, but its poll-2 fix is still within one
  -- missed poll of the newest snapshot, so it's shown, dimmed by the
  -- browser. Its route changed between poll 1 and poll 2, so there's no
  -- previous fix to interpolate from (no line across a route change).
  -- jsonb_build_object stores a SQL NULL as the JSON literal null, not as a
  -- missing key, so "is not null" on the extracted value is always true:
  -- check its JSON type instead.
  if (by_id -> 'busC' -> 'latest' ->> 't')::timestamptz <> '2020-06-01T00:01:15Z'::timestamptz
     or (by_id -> 'busC' ->> 'route_id') <> '30'
     or jsonb_typeof(by_id -> 'busC' -> 'previous') <> 'null' then
    raise exception 'FAIL: busC should show its route-30 fix with no previous (route changed), got %', by_id -> 'busC';
  end if;
end $$;

rollback; -- leave no trace if run against a real database by hand

\echo 'current_state.test.sql: all assertions passed'
