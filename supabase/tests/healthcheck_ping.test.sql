-- SQL fixture test for ping_healthcheck() / ingest_runs_ping_healthcheck
-- (board fix 6, and 2026-10-20: ping only when the feed advanced). Run
-- against a scratch database with the migrations applied -- see
-- .github/workflows/ci.yml.
--
-- Plain Postgres has neither vault nor pg_net (those are Supabase-platform
-- extensions), so this stubs just enough of each to exercise the trigger's
-- actual logic: a vault.decrypted_secrets lookalike holding the secret, and
-- a net.http_get lookalike that logs calls to a table instead of making a
-- real HTTP request.
--
-- Run by hand against a local scratch Postgres, as CI does:
--   createdb city_pulse_test
--   psql city_pulse_test -c "create role anon; create role authenticated; create role service_role;"
--   psql city_pulse_test -v ON_ERROR_STOP=1 $(scripts/sql-fixture-files.sh)
--   dropdb city_pulse_test

begin;

\set ON_ERROR_STOP 1

create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);

create schema net;
create table net._test_pings (url text, called_at timestamptz not null default clock_timestamp());
create function net.http_get(url text, timeout_milliseconds integer default 5000)
returns bigint
language plpgsql
as $$
begin
  insert into net._test_pings (url) values (url);
  return 1;
end;
$$;

-- A feed snapshot at `t`, then a run that ends `status`.
create function pg_temp.snapshot(t timestamptz) returns void language sql as $$
  insert into public.vehicle_observations (source, upstream_id, feed_timestamp, lat, lng)
  values ('sf511-muni', 'bus-1', t, 37.77, -122.42)
$$;
create function pg_temp.run(status text) returns bigint language plpgsql as $$
declare
  run_id bigint;
begin
  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = run.status, finished_at = now() where id = run_id;
  return run_id;
end;
$$;
create function pg_temp.pings() returns integer language sql as $$
  select count(*)::integer from net._test_pings
$$;

-- Scenario 1: healthcheck_url isn't in Vault yet. An ok run that advanced
-- the feed must still finish cleanly and must not try to ping anywhere.
do $$
begin
  perform pg_temp.snapshot('2020-01-01 00:00:00+00');
  perform pg_temp.run('ok');
  if pg_temp.pings() <> 0 then
    raise exception 'FAIL: an ok run with no healthcheck_url configured should not ping, got %', pg_temp.pings();
  end if;
end $$;

insert into vault.decrypted_secrets (name, decrypted_secret)
values ('healthcheck_url', 'https://hc-ping.com/11111111-2222-3333-4444-555555555555');

-- Scenario 2: skipped_interval, skipped_budget and error never ping, even
-- with new data; the ok run that follows does, once, to the right URL.
do $$
declare
  last_url text;
begin
  perform pg_temp.snapshot('2020-01-01 00:01:20+00');
  perform pg_temp.run('skipped_interval');
  perform pg_temp.run('skipped_budget');
  perform pg_temp.run('error');
  if pg_temp.pings() <> 0 then
    raise exception 'FAIL: skipped_interval, skipped_budget and error must never ping, got %', pg_temp.pings();
  end if;

  perform pg_temp.run('ok');
  select max(url) into last_url from net._test_pings;
  if pg_temp.pings() <> 1 then
    raise exception 'FAIL: one ok run that advanced the feed should ping once, got %', pg_temp.pings();
  end if;
  if last_url <> 'https://hc-ping.com/11111111-2222-3333-4444-555555555555' then
    raise exception 'FAIL: pinged the wrong URL: %', last_url;
  end if;
end $$;

-- Scenario 3: the next ok run with a newer snapshot pings again; re-saving
-- an ok row doesn't.
do $$
declare
  run_id bigint;
begin
  perform pg_temp.snapshot('2020-01-01 00:02:40+00');
  run_id := pg_temp.run('ok');
  if pg_temp.pings() <> 2 then
    raise exception 'FAIL: an ok run with a newer snapshot should ping again, expected 2, got %', pg_temp.pings();
  end if;

  update public.ingest_runs set status = 'ok', finished_at = now() where id = run_id;
  if pg_temp.pings() <> 2 then
    raise exception 'FAIL: re-saving an already-ok row must not ping again, got %', pg_temp.pings();
  end if;
end $$;

-- Scenario 4: a frozen feed. 511 answers 200 with the same snapshot, so the
-- poller logs ok, but nothing advanced: no ping, so Healthchecks alerts.
do $$
begin
  perform pg_temp.run('ok');
  perform pg_temp.run('ok');
  if pg_temp.pings() <> 2 then
    raise exception 'FAIL: ok runs with no newer snapshot must not ping, expected 2, got %', pg_temp.pings();
  end if;
end $$;

-- Scenario 5: a ping failure never breaks the ingest_runs write, and the
-- next ok run retries (the failed attempt's state rolled back).
create or replace function net.http_get(url text, timeout_milliseconds integer default 5000)
returns bigint
language plpgsql
as $$
begin
  raise exception 'simulated network failure';
end;
$$;

do $$
declare
  run_id bigint;
  final_status text;
begin
  perform pg_temp.snapshot('2020-01-01 00:04:00+00');
  run_id := pg_temp.run('ok');
  select status into final_status from public.ingest_runs where id = run_id;
  if final_status <> 'ok' then
    raise exception 'FAIL: a ping failure must not break the ingest_runs write, got status %', final_status;
  end if;
end $$;

create or replace function net.http_get(url text, timeout_milliseconds integer default 5000)
returns bigint
language plpgsql
as $$
begin
  insert into net._test_pings (url) values (url);
  return 1;
end;
$$;

do $$
begin
  perform pg_temp.run('ok');
  if pg_temp.pings() <> 3 then
    raise exception 'FAIL: the ok run after a failed ping should retry it, expected 3, got %', pg_temp.pings();
  end if;
end $$;

rollback; -- leave no trace if run against a real database by hand

\echo 'healthcheck_ping.test.sql: all assertions passed'
