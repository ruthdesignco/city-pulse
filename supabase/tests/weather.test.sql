-- SQL fixture test for record_weather_observations() and current_state's
-- weather column (20261020120000_weather_observations.sql,
-- 20261021090000_wind_observed_at.sql). Run the same way
-- as current_state.test.sql (scripts/sql-fixture-files.sh, in CI's
-- sql-fixture job).
--
-- Times are in 2020, far from the wall clock: the station choice and the
-- 14-day prune are relative to the data, never to now(), and these would
-- break loudly if either went back to now().

begin;

\set ON_ERROR_STOP 1

-- No weather yet: the column is null and freshness.weather has nulls, not an error.
do $$
declare
  r record;
begin
  select * into r from public.current_state;
  if r.weather is not null then
    raise exception 'FAIL: weather should be null with no observations, got %', r.weather;
  end if;
  if jsonb_typeof(r.freshness -> 'weather' -> 'newest_observed_at') <> 'null' then
    raise exception 'FAIL: freshness.weather.newest_observed_at should be null, got %', r.freshness -> 'weather';
  end if;
end $$;

-- A KSFO row 20 days before the rest: pruned once the newer rows land.
select public.record_weather_observations('[
  {"station":"KSFO","observed_at":"2020-05-12T00:00:00Z","visibility_m":16093,"cloud_layers":[],
   "wind_speed_ms":3,"wind_dir_deg":270,"wind_gust_ms":null,"description":"Clear"}
]'::jsonb);

-- One fetch: KSFO's hourly report has wind, its 5-minute one after it doesn't.
-- KOAK has a newer report, but KSFO is within 90 minutes, so KSFO is shown.
do $$
declare
  inserted integer;
begin
  inserted := public.record_weather_observations('[
    {"station":"KSFO","observed_at":"2020-06-01T00:56:00Z","visibility_m":3200,
     "cloud_layers":[{"amount":"BKN","base_m":180},{"amount":"OVC","base_m":300}],
     "wind_speed_ms":5.1,"wind_dir_deg":290,"wind_gust_ms":null,"description":"Mist"},
    {"station":"KSFO","observed_at":"2020-06-01T01:05:00Z","visibility_m":800,
     "cloud_layers":[{"amount":"VV","base_m":60}],
     "wind_speed_ms":null,"wind_dir_deg":null,"wind_gust_ms":null,"description":"Fog"},
    {"station":"KOAK","observed_at":"2020-06-01T01:50:00Z","visibility_m":16093,
     "cloud_layers":[{"amount":"CLR","base_m":null}],
     "wind_speed_ms":6,"wind_dir_deg":300,"wind_gust_ms":null,"description":"Clear"}
  ]'::jsonb);
  if inserted <> 3 then
    raise exception 'FAIL: expected 3 new rows, got %', inserted;
  end if;
  -- The station resends the same reports on the next fetch: a no-op.
  inserted := public.record_weather_observations('[
    {"station":"KSFO","observed_at":"2020-06-01T01:05:00Z","visibility_m":800,"cloud_layers":[],
     "wind_speed_ms":null,"wind_dir_deg":null,"wind_gust_ms":null,"description":"Fog"}
  ]'::jsonb);
  if inserted <> 0 then
    raise exception 'FAIL: a resent report should insert 0 rows, got %', inserted;
  end if;
end $$;

insert into public.ingest_runs (source, status, finished_at) values
  ('nws', 'ok',    '2020-06-01T01:10:00Z'),
  ('nws', 'error', '2020-06-01T01:25:00Z'),
  ('sf511-muni', 'ok', '2020-06-01T01:30:00Z');

do $$
declare
  r record;
  n integer;
begin
  select count(*) into n from public.weather_observations where observed_at < '2020-05-20';
  if n <> 0 then
    raise exception 'FAIL: the 20-day-old KSFO row should have been pruned, found %', n;
  end if;
  select count(*) into n from public.weather_observations;
  if n <> 3 then
    raise exception 'FAIL: the prune went too far -- it must compare to the newest report, not now(); % rows left', n;
  end if;

  select * into r from public.current_state;
  if r.weather ->> 'station' <> 'KSFO'
     or (r.weather ->> 'observed_at')::timestamptz <> '2020-06-01T01:05:00Z'
     or (r.weather ->> 'visibility_m')::real <> 800
     or r.weather -> 'cloud_layers' -> 0 ->> 'amount' <> 'VV' then
    raise exception 'FAIL: expected KSFO''s 01:05 fog report, got %', r.weather;
  end if;
  -- Wind from KSFO's 00:56 report, the newest with wind; never from KOAK.
  if (r.weather ->> 'wind_speed_ms')::real <> 5.1::real or (r.weather ->> 'wind_dir_deg')::real <> 290
     or (r.weather ->> 'wind_observed_at')::timestamptz <> '2020-06-01T00:56:00Z' then
    raise exception 'FAIL: wind should come from KSFO''s 00:56 report, got %', r.weather;
  end if;
  if (r.freshness -> 'weather' ->> 'last_success_at')::timestamptz <> '2020-06-01T01:10:00Z'
     or (r.freshness -> 'weather' ->> 'last_poll_at')::timestamptz <> '2020-06-01T01:25:00Z'
     or (r.freshness -> 'weather' ->> 'last_poll_ok')::boolean
     or r.freshness -> 'weather' ->> 'station' <> 'KSFO'
     or (r.freshness -> 'weather' ->> 'newest_observed_at')::timestamptz <> '2020-06-01T01:05:00Z' then
    raise exception 'FAIL: freshness.weather is wrong: %', r.freshness -> 'weather';
  end if;
  -- The muni freshness ignores weather runs.
  if (r.freshness -> 'muni' ->> 'last_poll_at')::timestamptz <> '2020-06-01T01:30:00Z' then
    raise exception 'FAIL: freshness.muni should only see sf511-muni runs, got %', r.freshness -> 'muni';
  end if;
end $$;

-- KOAK reports 2 hours after KSFO's newest: KSFO has gone quiet, so KOAK is shown.
select public.record_weather_observations('[
  {"station":"KOAK","observed_at":"2020-06-01T03:10:00Z","visibility_m":9000,
   "cloud_layers":[{"amount":"SCT","base_m":600}],
   "wind_speed_ms":null,"wind_dir_deg":null,"wind_gust_ms":null,"description":"Partly Cloudy"}
]'::jsonb);

do $$
declare
  r record;
begin
  select * into r from public.current_state;
  if r.weather ->> 'station' <> 'KOAK' or (r.weather ->> 'observed_at')::timestamptz <> '2020-06-01T03:10:00Z' then
    raise exception 'FAIL: with KSFO 2 h behind, KOAK''s report should be shown, got %', r.weather;
  end if;
  -- KOAK's 01:50 wind is 80 minutes old: within 90 minutes, so it's used.
  if (r.weather ->> 'wind_speed_ms')::real <> 6
     or (r.weather ->> 'wind_observed_at')::timestamptz <> '2020-06-01T01:50:00Z' then
    raise exception 'FAIL: wind should fall back to KOAK''s 01:50 report, got %', r.weather;
  end if;
  if r.freshness -> 'weather' ->> 'station' <> 'KOAK' then
    raise exception 'FAIL: freshness.weather.station should be KOAK, got %', r.freshness -> 'weather';
  end if;
end $$;

-- KOAK's next report, 100 minutes after its last with wind: too old, so no wind.
select public.record_weather_observations('[
  {"station":"KOAK","observed_at":"2020-06-01T03:30:00Z","visibility_m":9000,"cloud_layers":[],
   "wind_speed_ms":null,"wind_dir_deg":null,"wind_gust_ms":null,"description":"Clear"}
]'::jsonb);

do $$
declare
  r record;
begin
  select * into r from public.current_state;
  if r.weather ->> 'station' <> 'KOAK'
     or jsonb_typeof(r.weather -> 'wind_speed_ms') <> 'null'
     or jsonb_typeof(r.weather -> 'wind_observed_at') <> 'null' then
    raise exception 'FAIL: wind 100 minutes old should be left out, got %', r.weather;
  end if;
end $$;

-- anon still reads only the view.
do $$
begin
  if has_table_privilege('anon', 'public.weather_observations', 'select') then
    raise exception 'FAIL: anon must not read weather_observations';
  end if;
  if has_function_privilege('anon', 'public.record_weather_observations(jsonb)', 'execute') then
    raise exception 'FAIL: anon must not call record_weather_observations';
  end if;
end $$;

rollback; -- leave no trace if run against a real database by hand

\echo 'weather.test.sql: all assertions passed'
