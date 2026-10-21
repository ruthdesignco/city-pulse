-- Schedule the weather fetch: the same poller Edge Function, with body
-- {"feed":"nws"}, four times an hour. It's its own job, not a branch of the
-- 20-second 511 tick, so it never touches the 511 budget and a slow or
-- failing weather call can't delay a bus poll. Off the hour, since NWS asks
-- clients not to pile onto :00.
--
-- Uses the same Vault secrets as poll-feeds (20261018210000_poller_cron.sql);
-- nothing new to create. Platform-only (pg_cron, Vault), so CI's SQL fixture
-- skips it (scripts/sql-fixture-files.sh).

select cron.schedule(
  'poll-weather',
  '4,19,34,49 * * * *',
  $$
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-poller-secret', s.secret),
    body := '{"feed":"nws"}'::jsonb,
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
