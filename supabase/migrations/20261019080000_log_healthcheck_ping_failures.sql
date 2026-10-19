-- ping_healthcheck()'s safety net (never let a ping failure break the
-- ingest_runs write) also meant a misconfigured or undecryptable secret was
-- completely invisible: zero pings reached Healthchecks.io and nothing,
-- anywhere, said why. Log it instead of swallowing it silently.
--
-- RAISE WARNING only ever carries the Postgres error message and SQLSTATE
-- (e.g. "permission denied for function ..." or a pg_net error) -- never the
-- secret value itself. Check Supabase Dashboard -> Logs -> Postgres Logs,
-- filtered to "ping_healthcheck", after the next ok run.

create or replace function public.ping_healthcheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
begin
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'healthcheck_url');
  if url is null then
    raise warning 'ping_healthcheck: healthcheck_url not found in Vault (or NULL) -- not pinging';
  else
    perform net.http_get(url := url, timeout_milliseconds := 5000);
  end if;
  return null; -- an after-trigger's return value is ignored
exception when others then
  -- A ping failure (bad URL, pg_net hiccup, Healthchecks.io down) must still
  -- never break the ingest_runs write it's piggybacking on -- just log it.
  raise warning 'ping_healthcheck: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;
