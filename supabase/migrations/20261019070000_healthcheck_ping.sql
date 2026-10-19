-- Board fix 6: dead-man's switch. Pings a Healthchecks.io check whenever (and
-- only when) a poller run actually finishes ok -- never on skipped_interval,
-- skipped_budget or error. That catches exactly what writes nothing today:
-- 401s, a dead cron job, a paused or spend-capped project, a 511 outage.
--
-- Event-driven, not a separate polling cron job: finishRun() (db.ts) already
-- does `update ingest_runs set status = ...` for every run, so a trigger on
-- that write is the one place every ok run already passes through.
--
-- The ping URL lives only in Vault, like poller_secret (see
-- 20261019040000_poller_secret_from_vault.sql) -- never in this repo, never
-- typed where an agent or a chat can see it.
--
-- Add it once, from the Supabase Studio SQL Editor (not a terminal, so it
-- never touches shell history), for project jegmwhfbdhohvysbmjdw:
--   select vault.create_secret(
--     '<paste the Healthchecks.io ping URL here>',
--     'healthcheck_url',
--     'Dead-man''s switch ping URL for the poller'
--   );
-- Only the returned secret id prints; the value itself never appears in any
-- query result. Confirm it saved without ever selecting decrypted_secret:
--   select id, name, created_at from vault.secrets where name = 'healthcheck_url';
-- Never paste the URL into a Claude chat or any other agent session.
--
-- Until that secret exists, every 'ok' run still finishes normally; the
-- trigger just finds nothing to ping and does nothing.

create function public.ping_healthcheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
begin
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'healthcheck_url');
  if url is not null then
    perform net.http_get(url := url, timeout_milliseconds := 5000);
  end if;
  return null; -- an after-trigger's return value is ignored
exception when others then
  -- A ping failure (bad URL, pg_net hiccup, Healthchecks.io down) must never
  -- break the ingest_runs write it's piggybacking on.
  return null;
end;
$$;

comment on function public.ping_healthcheck() is
  'Pings Vault''s healthcheck_url on every ok poller run. See ingest_runs_ping_healthcheck trigger.';

-- Belt-and-suspenders, same as rls_auto_enable(): Postgres never lets a
-- trigger-returning function be called directly as a statement or an RPC
-- regardless of grants, but keep the exposed schema clean anyway.
revoke all on function public.ping_healthcheck() from public, anon, authenticated;

create trigger ingest_runs_ping_healthcheck
after update of status on public.ingest_runs
for each row
when (new.status = 'ok' and old.status is distinct from new.status)
execute function public.ping_healthcheck();
