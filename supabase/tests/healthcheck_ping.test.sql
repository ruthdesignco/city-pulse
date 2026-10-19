-- SQL fixture test for ping_healthcheck() / ingest_runs_ping_healthcheck
-- (board fix 6). Run against a scratch database that already has
-- ingest_schema.sql and healthcheck_ping.sql applied -- see
-- .github/workflows/ci.yml.
--
-- Plain Postgres has neither vault nor pg_net (those are Supabase-platform
-- extensions), so this stubs just enough of each to exercise the trigger's
-- actual logic: a vault.decrypted_secrets lookalike holding the secret, and
-- a net.http_get lookalike that logs calls to a table instead of making a
-- real HTTP request.
--
-- Run by hand against a local scratch Postgres:
--   createdb city_pulse_test
--   psql city_pulse_test -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20261018200000_ingest_schema.sql \
--     -f supabase/migrations/20261019070000_healthcheck_ping.sql \
--     -f supabase/tests/healthcheck_ping.test.sql
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

-- Scenario 1: healthcheck_url isn't in Vault yet. An ok run must still
-- finish cleanly and must not try to ping anywhere.
do $$
declare
  run_id bigint;
  pings integer;
begin
  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'ok', finished_at = now(), rows_written = 10 where id = run_id;

  select count(*) into pings from net._test_pings;
  if pings <> 0 then
    raise exception 'FAIL: an ok run with no healthcheck_url configured should not ping, got % ping(s)', pings;
  end if;
end $$;

insert into vault.decrypted_secrets (name, decrypted_secret)
values ('healthcheck_url', 'https://hc-ping.com/11111111-2222-3333-4444-555555555555');

-- Scenario 2: skipped_interval, skipped_budget and error must never ping;
-- only the ok run that follows them does, exactly once, to the right URL.
do $$
declare
  run_id bigint;
  pings integer;
  last_url text;
begin
  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'skipped_interval', finished_at = now() where id = run_id;

  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'skipped_budget', finished_at = now() where id = run_id;

  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'error', finished_at = now(), error = 'HTTP 500' where id = run_id;

  select count(*) into pings from net._test_pings;
  if pings <> 0 then
    raise exception 'FAIL: skipped_interval, skipped_budget and error must never ping, got % ping(s)', pings;
  end if;

  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'ok', finished_at = now(), rows_written = 12 where id = run_id;

  select count(*), max(url) into pings, last_url from net._test_pings;
  if pings <> 1 then
    raise exception 'FAIL: exactly one ok run should ping exactly once, got % ping(s)', pings;
  end if;
  if last_url <> 'https://hc-ping.com/11111111-2222-3333-4444-555555555555' then
    raise exception 'FAIL: pinged the wrong URL: %', last_url;
  end if;
end $$;

-- Scenario 3: every fresh ok run pings again -- this is a per-run signal,
-- not a one-time latch.
do $$
declare
  run_id bigint;
  pings integer;
begin
  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'ok', finished_at = now() where id = run_id;

  select count(*) into pings from net._test_pings;
  if pings <> 2 then
    raise exception 'FAIL: a second fresh ok run should ping again, expected 2 total pings, got %', pings;
  end if;

  -- Re-saving the same row as 'ok' again (old.status = new.status = 'ok')
  -- must not re-ping: the WHEN clause requires an actual transition.
  update public.ingest_runs set status = 'ok', finished_at = now() where id = run_id;

  select count(*) into pings from net._test_pings;
  if pings <> 2 then
    raise exception 'FAIL: re-saving an already-ok row must not ping again, got %', pings;
  end if;
end $$;

-- Scenario 4: a ping failure (bad URL, pg_net down, Healthchecks.io down)
-- must never break the ingest_runs write it's piggybacking on.
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
  insert into public.ingest_runs (source) values ('sf511-muni') returning id into run_id;
  update public.ingest_runs set status = 'ok', finished_at = now() where id = run_id;

  select status into final_status from public.ingest_runs where id = run_id;
  if final_status <> 'ok' then
    raise exception 'FAIL: a ping failure must not break the ingest_runs write, got status %', final_status;
  end if;
end $$;

rollback; -- leave no trace if run against a real database by hand

\echo 'healthcheck_ping.test.sql: all assertions passed'
