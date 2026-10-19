-- Schedule the poller Edge Function every 20 seconds, plus daily retention.
--
-- Before this does anything, create two Vault secrets by hand (never in a
-- committed file):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/poller', 'poller_url');
--   select vault.create_secret('<random 32+ byte string>', 'poller_secret');
-- poller_secret must equal the Edge Function's POLLER_SECRET. Until both
-- exist the job selects zero rows and sends nothing.
--
-- Most ticks are no-ops by design: the poller itself gates 511 calls on
-- poll_budget (75 s spacing, 60/hour), so a 20 s tick only bounds how late a
-- call can be. Every tick is logged to ingest_runs.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Secrets are read at run time, so cron.job and cron.job_run_details only
-- ever hold this text, never the values.
select cron.schedule(
  'poll-feeds',
  '20 seconds',
  $$
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-poller-secret', s.secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'poller_url') as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'poller_secret') as secret
  ) s
  where s.url is not null and s.secret is not null;
  $$
);

-- ingest_runs gets ~4,300 rows/day (one per tick); keep two weeks.
select cron.schedule(
  'prune-ingest-runs',
  '17 4 * * *',
  $$ delete from public.ingest_runs where started_at < now() - interval '14 days' $$
);

-- pg_cron logs every run too; at a 20 s cadence that adds up.
select cron.schedule(
  'prune-cron-history',
  '23 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '2 days' $$
);
