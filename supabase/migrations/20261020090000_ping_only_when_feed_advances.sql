-- Board fix (2026-10-20): ping Healthchecks.io only when an ok run actually
-- advanced the feed. 511 can keep answering 200 with a frozen snapshot; the
-- poller logs those runs ok, and until now each one still pinged, so a stuck
-- feed never alerted. Now the ping fires only when the newest observation's
-- feed_timestamp for that source is later than the one at the last ping. A
-- frozen feed stops pinging and Healthchecks' grace period runs out.
--
-- healthcheck_state holds that last-pinged timestamp per source. It's
-- written only by ping_healthcheck() (security definer) and readable by no
-- client role.

create table public.healthcheck_state (
  source              text        primary key,
  last_feed_timestamp timestamptz not null
);

comment on table public.healthcheck_state is
  'Newest feed_timestamp seen at the last Healthchecks ping, per source. Written by ping_healthcheck().';

alter table public.healthcheck_state enable row level security;
revoke all on public.healthcheck_state from public, anon, authenticated;

create or replace function public.ping_healthcheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  newest timestamptz;
  last_pinged timestamptz;
begin
  select max(o.feed_timestamp) into newest
  from public.vehicle_observations o
  where o.source = new.source;
  select s.last_feed_timestamp into last_pinged
  from public.healthcheck_state s
  where s.source = new.source;
  -- No data yet, or the same snapshot as last time: no ping.
  if newest is null or (last_pinged is not null and newest <= last_pinged) then
    return null;
  end if;

  insert into public.healthcheck_state (source, last_feed_timestamp)
  values (new.source, newest)
  on conflict (source) do update set last_feed_timestamp = excluded.last_feed_timestamp;

  url := (select decrypted_secret from vault.decrypted_secrets where name = 'healthcheck_url');
  if url is null then
    raise warning 'ping_healthcheck: healthcheck_url not found in Vault (or NULL) -- not pinging';
  else
    perform net.http_get(url := url, timeout_milliseconds := 5000);
  end if;
  return null; -- an after-trigger's return value is ignored
exception when others then
  -- A ping failure must never break the ingest_runs write it's piggybacking
  -- on. The block's own writes (healthcheck_state) roll back with it, so the
  -- next ok run tries again.
  raise warning 'ping_healthcheck: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

comment on function public.ping_healthcheck() is
  'Pings Vault''s healthcheck_url on an ok poller run that advanced the feed. See ingest_runs_ping_healthcheck trigger.';
